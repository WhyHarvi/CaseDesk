import prisma from "./prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { logger } from "./logger.js";
import { assertSlotAvailable } from "./bookingAvailabilityService.js";
import { chooseAppointmentAssignee, lockSchedulingTransaction } from "./schedulingAssignmentService.js";
import {
  createQuickBooksCustomer,
  createQuickBooksInvoice,
  findQuickBooksCustomerByEmail,
  voidQuickBooksInvoice,
} from "./quickbooksService.js";
import { reconcilePaymentHold } from "./quickbooksWebhookService.js";
import { notifyUsers, schedulingCoordinatorRecipientIds } from "./notificationService.js";
import { paymentHoldMeetingFields } from "./bookingMeetingModeService.js";

// Standalone resolver, deliberately not layered onto caseInvoiceService.js's
// requireMappedItem/PAYMENT_TYPES — those are also consumed by payment
// schedule installment validation, and a consult fee is a different concept
// from a case retainer installment type.
export async function requireConsultFeeItem(agencyId) {
  const settings = await prisma.agencyQuickBooksSettings.findUnique({ where: { agencyId } });
  if (!settings || settings.status !== "connected") {
    throw createHttpError(409, "Connect QuickBooks in Settings before paid bookings can be taken.", "QBO_NOT_CONNECTED");
  }
  if (!settings.consultFeeItemId) {
    throw createHttpError(409, "Map a QuickBooks item for consultation fees in Settings before paid bookings can be taken.", "QBO_MAPPING_REQUIRED");
  }
  return settings.consultFeeItemId;
}

// A booker at this point has no Client row yet (guest booking, pre-lead) —
// resolve/create the QuickBooks customer directly from raw contact fields
// rather than going through clientQuickBooksSyncService.js, which is
// Client-row-shaped.
export async function resolveOrCreateQuickBooksCustomer(agencyId, { name, email, phone }) {
  const existing = await findQuickBooksCustomerByEmail(agencyId, email);
  if (existing) return existing.id;
  const created = await createQuickBooksCustomer(agencyId, { displayName: name, email, phone });
  return created.id;
}

/**
 * Locks the slot (via a committed BookingPaymentHold row, exactly like the
 * existing BookingSlotHold pattern) and creates the matching QuickBooks
 * invoice. The hold row is inserted with null qb* fields first — Postgres
 * allows multiple NULLs under the (agencyId, qbInvoiceId) unique index, so
 * two concurrent holds mid-creation never collide — then patched once the
 * QuickBooks calls resolve. Any failure past the slot lock deletes the hold
 * so it never blocks the slot without a way to pay for it.
 */
export async function createPaymentHoldForPublicBooking(agencyId, {
  sessionTypeId,
  sessionTypeName,
  startsAt,
  endsAt,
  requestedConsultantId,
  preferredConsultantId = null,
  meetingMode,
  settings,
  location,
  name,
  email,
  phone,
  notes,
  amount,
  holdMinutes,
  idempotencyKey,
  bufferMinutes,
  offerHold = null,
}) {
  const itemId = await requireConsultFeeItem(agencyId);

  const reservation = await prisma.$transaction(async (tx) => {
    await lockSchedulingTransaction(tx, agencyId, startsAt);
    // The controller performs the fast idempotency lookup before any
    // availability work. Repeat it under the scheduling lock to close the
    // race where two tabs submit the same key before either hold exists.
    if (idempotencyKey) {
      const existing = await tx.bookingPaymentHold.findUnique({
        where: { agencyId_idempotencyKey: { agencyId, idempotencyKey } },
      });
      if (existing) return { hold: existing, reused: true };
    }
    const expiresAt = new Date(Date.now() + holdMinutes * 60_000);
    if (offerHold) {
      const activeOffer = await tx.bookingSlotHold.updateMany({
        where: { id: offerHold.id, claimToken: offerHold.claimToken, claimedAt: null, expiresAt: { gt: new Date() } },
        data: { expiresAt },
      });
      if (!activeOffer.count) {
        throw createHttpError(409, "This reserved waitlist time has expired.", "OFFER_EXPIRED");
      }
      await tx.bookingWaitlistEntry.updateMany({
        where: { id: offerHold.waitlistEntryId, status: "Offered", offerToken: offerHold.claimToken },
        data: { offerExpiresAt: expiresAt },
      });
    }
    const assignee = await chooseAppointmentAssignee({
      agencyId,
      sessionTypeId,
      startsAt,
      endsAt,
      requestedUserId: requestedConsultantId,
      preferredUserId: preferredConsultantId,
      publicOnly: true,
      bufferMinutes,
      // Without this, a client paying for a slot they were personally
      // offered from the waitlist collides with their own still-reserved
      // BookingSlotHold — assertSlotAvailable sees it as a real conflict
      // and rejects the very booking the offer was for.
      excludeHoldToken: offerHold?.claimToken || null,
      meetingMode,
      db: tx,
    });
    const conflict = await assertSlotAvailable(tx, { agencyId, assignedToId: assignee.id, startsAt, endsAt, bufferMinutes, excludeHoldToken: offerHold?.claimToken || null });
    if (conflict) throw createHttpError(409, "That time was just taken. Pick another slot.", "SLOT_TAKEN");

    const hold = await tx.bookingPaymentHold.create({
      data: {
        agencyId,
        assignedToId: assignee.id,
        sessionTypeId,
        startsAt,
        endsAt,
        idempotencyKey,
        guestName: name,
        guestEmail: email,
        guestEmailNormalized: email,
        guestPhone: phone || null,
        ...paymentHoldMeetingFields({ mode: meetingMode, settings }),
        locationId: location?.id || null,
        location: location ? `${location.name} — ${location.address}` : null,
        locationMapsUrl: location?.mapsUrl || null,
        notes: notes || null,
        amount,
        expiresAt,
        // Deliberately NOT claiming the waitlist offer here — the client
        // hasn't paid yet. It gets claimed (and the BookingWaitlistEntry
        // marked "Booked") only once payment actually confirms, in
        // confirmPaymentHold — if this hold expires unpaid instead, the
        // offer stays open exactly as if it were never touched.
        offerHoldId: offerHold?.id || null,
      },
    });
    return { hold, reused: false };
  });
  const holdRow = reservation.hold;
  if (reservation.reused) return holdRow;

  let holdDeleted = false;
  async function releaseHold() {
    if (holdDeleted) return;
    holdDeleted = true;
    await prisma.bookingPaymentHold.delete({ where: { id: holdRow.id } }).catch(() => {});
  }

  let createdInvoice = null;
  let invoiceVoided = false;
  try {
    const qbCustomerId = await resolveOrCreateQuickBooksCustomer(agencyId, { name, email, phone });
    const invoice = await createQuickBooksInvoice(agencyId, {
      customerId: qbCustomerId,
      itemId,
      description: `${sessionTypeName} — consultation booking`,
      amount,
    });
    createdInvoice = invoice;
    if (!invoice.invoiceLink) {
      try {
        await voidQuickBooksInvoice(agencyId, { id: invoice.id, syncToken: invoice.syncToken });
        invoiceVoided = true;
      } catch (error) {
        logger.warn("booking_payment_hold.void_after_no_link_failed", { agencyId, holdId: holdRow.id, reason: error.message });
      }
      await releaseHold();
      throw createHttpError(409, "Online card payment is not available yet — QuickBooks Payments must be enabled on the connected company.", "QBO_PAYMENTS_NOT_ENABLED");
    }
    return await prisma.bookingPaymentHold.update({
      where: { id: holdRow.id },
      data: { qbCustomerId, qbInvoiceId: invoice.id, qbInvoiceLink: invoice.invoiceLink, qbSyncToken: invoice.syncToken },
    });
  } catch (error) {
    // If QuickBooks accepted the invoice but persisting its identifiers
    // failed, do not leave an untracked open invoice that a client could
    // pay without CaseDesk having any route to confirm the appointment.
    if (createdInvoice?.id && !invoiceVoided) {
      await voidQuickBooksInvoice(agencyId, { id: createdInvoice.id, syncToken: createdInvoice.syncToken }).catch((voidError) => {
        logger.warn("booking_payment_hold.void_after_persist_failure_failed", {
          agencyId,
          holdId: holdRow.id,
          invoiceId: createdInvoice.id,
          reason: voidError.message,
        });
      });
    }
    await releaseHold();
    throw error;
  }
}

export async function getPaymentHoldStatus(agencyId, claimToken) {
  const hold = await prisma.bookingPaymentHold.findFirst({
    where: { agencyId, claimToken },
    include: {
      appointment: {
        include: {
          assignedTo: { select: { id: true, fullName: true } },
          sessionType: {
            select: {
              preparationInstructions: true,
              preparationChecklist: true,
              parkingInstructions: true,
            },
          },
        },
      },
    },
  });
  if (!hold) throw createHttpError(404, "This booking could not be found.", "NOT_FOUND");
  return hold;
}

/**
 * Front-desk "on the spot" flow: the appointment already exists (created
 * through the normal staff booking flow, no hold/expiry involved) — this
 * just generates a QuickBooks invoice + pay-now link for a walk-in client
 * to pay by card, with expiresAt: null since there's no slot to protect.
 * Unlike the public flow, a missing invoiceLink is not fatal here — the
 * appointment stays valid regardless, staff can still collect payment via
 * the existing cash/e-transfer tools; the hold just won't have a link to
 * share.
 */
export async function createPaymentHoldForWalkIn(agencyId, { appointmentId, actorUserId }) {
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, agencyId },
    include: { client: { select: { id: true, fullName: true, email: true, phone: true } } },
  });
  if (!appointment) throw createHttpError(404, "Appointment not found.", "NOT_FOUND");
  if (appointment.status !== "Scheduled") throw createHttpError(409, "Only a scheduled appointment can be charged.", "INVALID_STATE");
  if (!appointment.assignedToId) throw createHttpError(409, "This appointment has no consultant assigned yet.", "VALIDATION_ERROR");

  // appointmentId is unique on BookingPaymentHold — at most one hold can
  // ever exist per appointment, so an existing one (any status) is always
  // returned rather than attempting a second invoice for the same booking.
  const existingHold = await prisma.bookingPaymentHold.findUnique({ where: { appointmentId } });
  if (existingHold) return existingHold;

  const settings = await prisma.bookingSettings.findUnique({ where: { agencyId } });
  if (!settings?.consultFeeAmount) throw createHttpError(409, "Set a consultation fee in Settings before generating a pay-now link.", "VALIDATION_ERROR");

  const name = appointment.client?.fullName || appointment.guestName;
  const email = appointment.client?.email || appointment.guestEmail;
  const phone = appointment.client?.phone || appointment.guestPhone;
  if (!email) throw createHttpError(409, "This appointment has no email on file to bill.", "VALIDATION_ERROR");

  const itemId = await requireConsultFeeItem(agencyId);
  const qbCustomerId = await resolveOrCreateQuickBooksCustomer(agencyId, { name, email, phone });
  const amount = Number(settings.consultFeeAmount);
  const invoice = await createQuickBooksInvoice(agencyId, {
    customerId: qbCustomerId,
    itemId,
    description: `${appointment.subject} — consultation booking`,
    amount,
  });

  try {
    return await prisma.bookingPaymentHold.create({
      data: {
        agencyId,
        assignedToId: appointment.assignedToId,
        sessionTypeId: appointment.sessionTypeId,
        startsAt: appointment.startsAt,
        endsAt: appointment.endsAt,
        guestName: name,
        guestEmail: email,
        guestEmailNormalized: email.toLowerCase(),
        guestPhone: phone || null,
        meetingMode: appointment.meetingMode,
        meetingPhoneNumber: appointment.meetingPhoneNumber,
        meetingProvider: appointment.meetingProvider,
        amount,
        qbCustomerId,
        qbInvoiceId: invoice.id,
        qbInvoiceLink: invoice.invoiceLink,
        qbSyncToken: invoice.syncToken,
        status: "AwaitingPayment",
        source: "WalkIn",
        expiresAt: null,
        appointmentId: appointment.id,
        createdById: actorUserId,
      },
    });
  } catch (error) {
    await voidQuickBooksInvoice(agencyId, { id: invoice.id, syncToken: invoice.syncToken }).catch((voidError) => {
      logger.warn("booking_payment_hold.walk_in_void_after_persist_failure_failed", {
        agencyId,
        appointmentId: appointment.id,
        invoiceId: invoice.id,
        reason: voidError.message,
      });
    });
    throw error;
  }
}

// ---------- Active-hold reconciliation ----------
//
// QuickBooks webhooks are the intended fast path for noticing a payment the
// instant it completes, but they depend on external config (the app's
// webhook verifier token matching what's registered in Intuit's developer
// dashboard) that has silently drifted out of sync before with zero
// server-side signal. Without this poller, the only thing that ever
// re-checked an unpaid hold against QuickBooks was the expiry sweep just
// before it gave up on the hold — so a real paid booking could sit
// unconfirmed for the entire ~20-minute hold window. This checks every
// still-active hold on a short interval regardless of webhook health, so
// confirmation lands in seconds even if webhooks never get fixed.
const ACTIVE_HOLD_POLL_MS = 20_000;
let activeHoldPollTimer = null;
let activeHoldPollRunning = false;

export async function reconcileActivePaymentHolds() {
  if (activeHoldPollRunning) return 0;
  activeHoldPollRunning = true;
  try {
    const now = new Date();
    const active = await prisma.bookingPaymentHold.findMany({
      where: {
        status: "AwaitingPayment",
        qbInvoiceId: { not: null },
        OR: [
          { expiresAt: { gt: now } },
          {
            source: "WalkIn",
            expiresAt: null,
            createdAt: { gte: new Date(now.getTime() - 30 * 86_400_000) },
          },
        ],
      },
      select: { id: true, agencyId: true },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: 200,
    });
    for (const hold of active) {
      try {
        await reconcilePaymentHold(hold.agencyId, hold.id);
      } catch (error) {
        logger.warn("booking_payment_hold.active_reconcile_failed", { agencyId: hold.agencyId, holdId: hold.id, reason: error.message });
      } finally {
        // A still-unpaid or temporarily unreachable hold otherwise remains
        // in the first 200 rows forever and starves newer checkouts. Touching
        // it moves it behind holds that have not had a recent poll.
        await prisma.bookingPaymentHold.updateMany({
          where: { id: hold.id, status: "AwaitingPayment" },
          data: { updatedAt: new Date() },
        }).catch((error) => {
          logger.warn("booking_payment_hold.active_reconcile_touch_failed", { agencyId: hold.agencyId, holdId: hold.id, reason: error.message });
        });
      }
    }
    return active.length;
  } finally {
    activeHoldPollRunning = false;
  }
}

// ---------- Expiry + void cleanup ----------
//
// Slot release never depends on this: assertSlotAvailable/availabilityForRange
// count AwaitingPayment only until expiry. Confirming remains blocking
// briefly even past expiry because verified money is being converted into
// an Appointment; the crash-recovery sweep below releases that state if a
// worker dies. This expiry worker's remaining job is bookkeeping: mark the
// row Expired and best-effort void the abandoned invoice so it doesn't sit
// Open in QuickBooks forever.

const HOLD_EXPIRY_POLL_MS = 60_000;
const VOID_RETRY_POLL_MS = 15 * 60_000;
const MAX_VOID_ATTEMPTS = 5;
// confirmPaymentHold claims a hold (AwaitingPayment -> Confirming) before
// doing any real work, and its own catch block reverts that claim on any
// thrown error — but a hard process crash/restart between the claim and the
// catch resolving leaves nothing to revert it. Nothing else ever queries
// "Confirming" (releaseExpiredPaymentHolds/retryFailedVoids/reconcilePaymentHold
// all explicitly exclude it), so without this sweep a hold stuck here — an
// invoice that IS paid in QuickBooks — would never produce an appointment.
const CONFIRMING_STUCK_MS = 5 * 60_000;
let holdExpiryTimer = null;
let voidRetryTimer = null;
let confirmingRecoveryTimer = null;

export async function recoverStuckConfirmingHolds() {
  const stuck = await prisma.bookingPaymentHold.findMany({
    where: { status: "Confirming", updatedAt: { lte: new Date(Date.now() - CONFIRMING_STUCK_MS) } },
    take: 100,
  });
  for (const hold of stuck) {
    const reverted = await prisma.bookingPaymentHold.updateMany({
      where: { id: hold.id, status: "Confirming" },
      data: { status: "AwaitingPayment" },
    });
    if (reverted.count === 1) {
      logger.warn("booking_payment_hold.confirming_recovered", { agencyId: hold.agencyId, holdId: hold.id });
    }
  }
  return stuck.length;
}

async function notifyExpiredHold(hold) {
  const recipientIds = await schedulingCoordinatorRecipientIds(hold.agencyId);
  if (!recipientIds.length) return;
  await notifyUsers({
    agencyId: hold.agencyId,
    recipientIds,
    type: "booking_payment.expired",
    category: "appointments",
    title: "Consultation payment not completed",
    body: `${hold.guestName} did not finish paying for their ${new Date(hold.startsAt).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })} consultation ($${Number(hold.amount).toFixed(2)}) — the hold expired and the slot has been released.`,
    severity: "warning",
    entityType: "bookingPaymentHold",
    entityId: hold.id,
    actionUrl: "/app/payments",
    metadata: { holdId: hold.id, amount: Number(hold.amount), guestName: hold.guestName },
    dedupeKey: `booking_payment_hold:${hold.id}:expired`,
    channels: ["in_app"],
  });
}

async function attemptVoid(hold) {
  if (!hold.qbInvoiceId) return;
  try {
    await voidQuickBooksInvoice(hold.agencyId, { id: hold.qbInvoiceId, syncToken: hold.qbSyncToken });
    await prisma.bookingPaymentHold.update({ where: { id: hold.id }, data: { voidedAt: new Date() } });
  } catch (error) {
    logger.warn("booking_payment_hold.void_failed", { agencyId: hold.agencyId, holdId: hold.id, attempt: hold.voidAttempts + 1, reason: error.message });
    await prisma.bookingPaymentHold.update({
      where: { id: hold.id },
      data: { voidAttempts: { increment: 1 }, nextVoidAttemptAt: new Date(Date.now() + VOID_RETRY_POLL_MS) },
    });
  }
}

export async function releaseExpiredPaymentHolds() {
  const expired = await prisma.bookingPaymentHold.findMany({
    where: { appointmentId: null, status: "AwaitingPayment", expiresAt: { lte: new Date() } },
    take: 100,
  });
  for (const hold of expired) {
    if (hold.qbInvoiceId) {
      try {
        const reconciled = await reconcilePaymentHold(hold.agencyId, hold.id, { force: true });
        if (reconciled?.status !== "AwaitingPayment") continue;
      } catch (error) {
        // A temporary QBO outage must not cause a potentially paid invoice
        // to be expired and voided. The next expiry pass will retry.
        logger.warn("booking_payment_hold.pre_expiry_reconcile_failed", {
          agencyId: hold.agencyId,
          holdId: hold.id,
          reason: error.message,
        });
        continue;
      }
    }
    const claimed = await prisma.bookingPaymentHold.updateMany({
      where: { id: hold.id, status: "AwaitingPayment", expiresAt: { lte: new Date() } },
      data: { status: "Expired" },
    });
    if (claimed.count !== 1) continue;
    const updated = await prisma.bookingPaymentHold.findUnique({ where: { id: hold.id } });
    await attemptVoid(updated);
    // A declined/abandoned card produces no QuickBooks webhook at all — this
    // expiry sweep is the only place that ever learns a checkout didn't
    // complete, so it's also the only place that can tell staff about it.
    await notifyExpiredHold(updated).catch((error) => {
      logger.warn("booking_payment_hold.expiry_notify_failed", { agencyId: hold.agencyId, holdId: hold.id, reason: error.message });
    });
  }
  return expired.length;
}

// Bounded retry for holds whose void failed on first attempt — after
// MAX_VOID_ATTEMPTS, stops retrying and leaves it Expired/unvoided for
// manual cleanup directly in QuickBooks. A stuck Open invoice from an
// abandoned checkout is a low-frequency, low-stakes failure mode; this
// deliberately does not build reconciliation tooling beyond this.
export async function retryFailedVoids() {
  const pending = await prisma.bookingPaymentHold.findMany({
    where: {
      status: "Expired",
      voidedAt: null,
      voidAttempts: { lt: MAX_VOID_ATTEMPTS },
      OR: [{ nextVoidAttemptAt: null }, { nextVoidAttemptAt: { lte: new Date() } }],
    },
    take: 100,
  });
  for (const hold of pending) {
    if (hold.qbInvoiceId) {
      try {
        const reconciled = await reconcilePaymentHold(hold.agencyId, hold.id, { allowExpired: true, force: true });
        if (reconciled?.status !== "Expired") continue;
      } catch (error) {
        logger.warn("booking_payment_hold.pre_void_reconcile_failed", {
          agencyId: hold.agencyId,
          holdId: hold.id,
          reason: error.message,
        });
        continue;
      }
    }
    await attemptVoid(hold);
  }
  return pending.length;
}

export function startPaymentHoldExpiryWorker() {
  if (!activeHoldPollTimer) {
    activeHoldPollTimer = setInterval(() => {
      reconcileActivePaymentHolds().catch((error) => logger.warn("booking_payment_hold.active_reconcile_pass_failed", { reason: error.message }));
    }, ACTIVE_HOLD_POLL_MS);
    if (activeHoldPollTimer.unref) activeHoldPollTimer.unref();
  }
  if (!holdExpiryTimer) {
    holdExpiryTimer = setInterval(() => {
      releaseExpiredPaymentHolds().catch((error) => logger.warn("booking_payment_hold.expiry_pass_failed", { reason: error.message }));
    }, HOLD_EXPIRY_POLL_MS);
    if (holdExpiryTimer.unref) holdExpiryTimer.unref();
  }
  if (!voidRetryTimer) {
    voidRetryTimer = setInterval(() => {
      retryFailedVoids().catch((error) => logger.warn("booking_payment_hold.void_retry_pass_failed", { reason: error.message }));
    }, VOID_RETRY_POLL_MS);
    if (voidRetryTimer.unref) voidRetryTimer.unref();
  }
  if (!confirmingRecoveryTimer) {
    confirmingRecoveryTimer = setInterval(() => {
      recoverStuckConfirmingHolds().catch((error) => logger.warn("booking_payment_hold.confirming_recovery_pass_failed", { reason: error.message }));
    }, HOLD_EXPIRY_POLL_MS);
    if (confirmingRecoveryTimer.unref) confirmingRecoveryTimer.unref();
  }
}

export function stopPaymentHoldExpiryWorker() {
  if (activeHoldPollTimer) clearInterval(activeHoldPollTimer);
  activeHoldPollTimer = null;
  if (holdExpiryTimer) clearInterval(holdExpiryTimer);
  holdExpiryTimer = null;
  if (voidRetryTimer) clearInterval(voidRetryTimer);
  voidRetryTimer = null;
  if (confirmingRecoveryTimer) clearInterval(confirmingRecoveryTimer);
  confirmingRecoveryTimer = null;
}
