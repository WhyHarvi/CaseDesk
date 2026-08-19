import prisma from "./prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { logger } from "./logger.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { assertSlotAvailable } from "./bookingAvailabilityService.js";
import { chooseAppointmentAssignee, lockSchedulingTransaction } from "./schedulingAssignmentService.js";
import {
  createQuickBooksCustomer,
  createQuickBooksConsultationInvoice,
  createQuickBooksReceivePayment,
  findOrCreateQuickBooksPaymentMethod,
  findQuickBooksPaymentIdForInvoice,
  findQuickBooksCustomerByEmail,
  getQuickBooksInvoice,
  isQuickBooksDuplicateNameError,
  updateQuickBooksPaymentDetails,
  voidQuickBooksInvoice,
} from "./quickbooksService.js";
import { reconcilePaymentHold } from "./quickbooksWebhookService.js";
import { captureAbandonedPublicBookingLead } from "../modules/leads/lead.booking.js";
import { financialOperationsRecipientIds, notifyUsers, resolveNotifications } from "./notificationService.js";
import { paymentHoldMeetingFields } from "./bookingMeetingModeService.js";
import { paymentHoldDeliverySummary, queuePaymentHoldMessages } from "./bookingNotificationService.js";
import { syncClientToQuickBooks } from "./clientQuickBooksSyncService.js";
import { requireFeeCategory } from "./feeCategoryService.js";
import { invalidateDashboardCache } from "./dashboardCache.js";
import { createApprovedCashLedgerRecord } from "./paymentApprovalLedgerService.js";
import { syncLeadConsultationPaymentFromEvidence } from "../modules/leads/lead.financial.service.js";

const MANUAL_PAYMENT_METHOD_LABELS = Object.freeze({
  Cash: "Cash",
  ETransfer: "E-transfer",
  Cheque: "Cheque",
  Wire: "Wire transfer",
  Debit: "Debit",
  BankDraft: "Bank draft",
});

// Standalone resolver, deliberately not layered onto caseInvoiceService.js's
// requireMappedItem/PAYMENT_TYPES — those are also consumed by payment
// schedule installment validation, and a consult fee is a different concept
// from a case retainer installment type.
export async function requireConsultFeeItem(agencyId) {
  const settings = await prisma.agencyQuickBooksSettings.findUnique({ where: { agencyId } });
  if (!settings || settings.status !== "connected") {
    throw createHttpError(409, "Connect QuickBooks in Settings before paid bookings can be taken.", "QBO_NOT_CONNECTED");
  }
  const category = await requireFeeCategory(agencyId, "consultation", { requireMapping: true });
  return category.qboItemId;
}

// A booker at this point has no Client row yet (guest booking, pre-lead) —
// resolve/create the QuickBooks customer directly from raw contact fields
// rather than going through clientQuickBooksSyncService.js, which is
// Client-row-shaped.
export async function resolveOrCreateQuickBooksCustomer(agencyId, { name, email, phone }) {
  const existing = email ? await findQuickBooksCustomerByEmail(agencyId, email) : null;
  if (existing) return existing.id;
  try {
    const created = await createQuickBooksCustomer(agencyId, { displayName: name, email, phone });
    return created.id;
  } catch (error) {
    if (!isQuickBooksDuplicateNameError(error)) throw error;

    // Another request may have created this email between our lookup and
    // create. Re-query first; otherwise use a deterministic unique display
    // name instead of attaching this booking to the same-name stranger.
    const raced = email ? await findQuickBooksCustomerByEmail(agencyId, email) : null;
    if (raced) return raced.id;
    const identitySuffix = String(email || phone || "CaseDesk")
      .trim()
      .toLowerCase()
      .slice(-40);
    const suffix = ` (${identitySuffix})`;
    const uniqueName = `${String(name || "Client").trim().slice(0, Math.max(1, 100 - suffix.length))}${suffix}`;
    try {
      const created = await createQuickBooksCustomer(agencyId, { displayName: uniqueName, email, phone });
      return created.id;
    } catch (retryError) {
      if (!isQuickBooksDuplicateNameError(retryError)) throw retryError;
      const concurrent = email ? await findQuickBooksCustomerByEmail(agencyId, email) : null;
      if (concurrent) return concurrent.id;
      throw retryError;
    }
  }
}

async function resolveQuickBooksCustomerForBooking(agencyId, { clientId, name, email, phone }) {
  if (clientId) {
    const client = await syncClientToQuickBooks(agencyId, clientId);
    if (!client?.qbCustomerId) {
      throw createHttpError(409, client?.qbSyncError || "This client could not be linked to QuickBooks.", "QBO_CLIENT_NOT_LINKED");
    }
    return client.qbCustomerId;
  }
  return resolveOrCreateQuickBooksCustomer(agencyId, { name, email, phone });
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
  clientId = null,
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
    const conflict = await assertSlotAvailable(tx, { agencyId, assignedToId: assignee.id, startsAt, endsAt, bufferMinutes, excludeHoldToken: offerHold?.claimToken || null, meetingMode });
    if (conflict) throw createHttpError(409, "That time was just taken. Pick another slot.", "SLOT_TAKEN");

    const hold = await tx.bookingPaymentHold.create({
      data: {
        agencyId,
        assignedToId: assignee.id,
        sessionTypeId,
        startsAt,
        endsAt,
        idempotencyKey,
        clientId,
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
    const qbCustomerId = await resolveQuickBooksCustomerForBooking(agencyId, {
      clientId,
      name,
      email,
      phone,
    });
    const invoice = await createQuickBooksConsultationInvoice(agencyId, {
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
      data: {
        qbCustomerId,
        qbInvoiceId: invoice.id,
        qbInvoiceNumber: invoice.docNumber,
        qbInvoiceLink: invoice.invoiceLink,
        qbSyncToken: invoice.syncToken,
      },
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

/**
 * Front-desk booking a client who will pay by card before the slot is
 * confirmed — mirrors createPaymentHoldForPublicBooking's reserve-then-
 * confirm pattern instead of createBookingAppointment's create-immediately
 * one: the slot is held (with a real expiry, same as the public page) and
 * the real Appointment isn't created until QuickBooks reports the invoice
 * paid, via the same confirmPaymentHold path the public flow's webhook
 * uses. Cash/e-transfer/free walk-ins don't go through this — those still
 * book immediately through createBookingAppointment.
 */
export async function createPaymentHoldForStaffBooking(agencyId, {
  sessionTypeId,
  sessionTypeName,
  subject,
  startsAt,
  endsAt,
  requestedUserId = null,
  meetingMode,
  settings,
  location,
  clientId = null,
  name,
  email,
  phone,
  notes,
  amount,
  bufferMinutes,
  actorUserId,
  idempotencyKey = null,
}) {
  const itemId = await requireConsultFeeItem(agencyId);
  const holdMinutes = settings.consultFeeHoldMinutes;

  const reservation = await prisma.$transaction(async (tx) => {
    await lockSchedulingTransaction(tx, agencyId, startsAt);
    if (idempotencyKey) {
      const existing = await tx.bookingPaymentHold.findUnique({
        where: { agencyId_idempotencyKey: { agencyId, idempotencyKey } },
      });
      if (existing) return { hold: existing, reused: true };
    }
    const expiresAt = new Date(Date.now() + holdMinutes * 60_000);
    const assignee = await chooseAppointmentAssignee({
      agencyId,
      sessionTypeId,
      startsAt,
      endsAt,
      requestedUserId,
      bufferMinutes,
      meetingMode,
      db: tx,
    });
    const conflict = await assertSlotAvailable(tx, { agencyId, assignedToId: assignee.id, startsAt, endsAt, bufferMinutes, meetingMode });
    if (conflict) throw createHttpError(409, "That time was just taken. Pick another slot.", "SLOT_TAKEN");

    const hold = await tx.bookingPaymentHold.create({
      data: {
        agencyId,
        assignedToId: assignee.id,
        sessionTypeId,
        startsAt,
        endsAt,
        clientId,
        guestName: name,
        guestEmail: email || null,
        guestEmailNormalized: email?.toLowerCase() || null,
        guestPhone: phone || null,
        ...paymentHoldMeetingFields({ mode: meetingMode, settings }),
        locationId: location?.id || null,
        location: location ? `${location.name} — ${location.address}` : null,
        locationMapsUrl: location?.mapsUrl || null,
        notes: notes || null,
        amount,
        expiresAt,
        source: "WalkIn",
        createdById: actorUserId,
        idempotencyKey,
      },
    });
    return { hold, reused: false };
  });
  const { hold, reused } = reservation;
  if (reused && hold.qbInvoiceId) return hold;

  let holdDeleted = false;
  async function releaseHold() {
    if (holdDeleted) return;
    holdDeleted = true;
    await prisma.bookingPaymentHold.delete({ where: { id: hold.id } }).catch(() => {});
  }

  let createdInvoice = null;
  let invoiceVoided = false;
  try {
    const qbCustomerId = await resolveQuickBooksCustomerForBooking(agencyId, { clientId, name, email, phone });
    const invoice = await createQuickBooksConsultationInvoice(agencyId, {
      customerId: qbCustomerId,
      itemId,
      description: `${sessionTypeName || subject || "Consultation"} — consultation booking`,
      amount,
      requestId: idempotencyKey ? `staff-booking-${idempotencyKey}` : undefined,
    });
    createdInvoice = invoice;
    if (!invoice.invoiceLink) {
      try {
        await voidQuickBooksInvoice(agencyId, { id: invoice.id, syncToken: invoice.syncToken });
        invoiceVoided = true;
      } catch (error) {
        logger.warn("booking_payment_hold.staff_void_after_no_link_failed", { agencyId, holdId: hold.id, reason: error.message });
      }
      await releaseHold();
      throw createHttpError(409, "Online card payment is not available yet — QuickBooks Payments must be enabled on the connected company.", "QBO_PAYMENTS_NOT_ENABLED");
    }
    const updated = await prisma.bookingPaymentHold.update({
      where: { id: hold.id },
      data: {
        qbCustomerId,
        qbInvoiceId: invoice.id,
        qbInvoiceNumber: invoice.docNumber,
        qbInvoiceLink: invoice.invoiceLink,
        qbSyncToken: invoice.syncToken,
      },
    });
    // This is queued rather than sent inline so mailbox/Ooma outages are
    // visible to staff, retried, and recoverable with an explicit resend.
    await queuePaymentHoldMessages({ agencyId, hold: updated, actorUserId });
    return updated;
  } catch (error) {
    if (createdInvoice?.id && !invoiceVoided) {
      await voidQuickBooksInvoice(agencyId, { id: createdInvoice.id, syncToken: createdInvoice.syncToken }).catch((voidError) => {
        logger.warn("booking_payment_hold.staff_void_after_persist_failure_failed", {
          agencyId,
          holdId: hold.id,
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
  if (!["Scheduled", "Completed", "NoShow"].includes(appointment.status)) {
    throw createHttpError(409, "Only a scheduled, attended, or no-show consultation can be charged.", "INVALID_STATE");
  }
  if (appointment.isFreeConsultation) throw createHttpError(409, "This is a free consultation — no payment is needed.", "FREE_CONSULTATION");
  if (!appointment.assignedToId) throw createHttpError(409, "This appointment has no consultant assigned yet.", "VALIDATION_ERROR");

  // appointmentId is unique on BookingPaymentHold — at most one hold can
  // ever exist per appointment, so an existing one (any status) is always
  // returned rather than attempting a second invoice for the same booking.
  const existingHold = await prisma.bookingPaymentHold.findUnique({ where: { appointmentId } });
  if (existingHold) {
    if (existingHold.status === "Paid") return existingHold;
    if (existingHold.status !== "AwaitingPayment" || !existingHold.qbInvoiceLink) {
      throw createHttpError(409, "The existing consultation payment request is not available for card payment. Resolve it in Payments, then try again.", "INVALID_STATE");
    }
    const updated = await prisma.bookingPaymentHold.update({
      where: { id: existingHold.id },
      data: { paymentMethod: "Card", paymentError: null },
    });
    await queuePaymentHoldMessages({ agencyId, hold: updated, actorUserId, dedupeSuffix: `card-${Date.now()}` });
    await resolveMissingAppointmentPaymentNotification(agencyId, appointmentId).catch(() => {});
    return updated;
  }

  const settings = await prisma.bookingSettings.findUnique({ where: { agencyId } });
  if (!settings?.consultFeeAmount) throw createHttpError(409, "Set a consultation fee in Settings before generating a pay-now link.", "VALIDATION_ERROR");

  const name = appointment.client?.fullName || appointment.guestName;
  const email = appointment.client?.email || appointment.guestEmail;
  const phone = appointment.client?.phone || appointment.guestPhone;
  if (!email && !phone) throw createHttpError(409, "Add an email address or phone number before sending a card payment link.", "VALIDATION_ERROR");

  const itemId = await requireConsultFeeItem(agencyId);
  const qbCustomerId = await resolveQuickBooksCustomerForBooking(agencyId, { clientId: appointment.clientId, name, email, phone });
  const amount = Number(settings.consultFeeAmount);
  const invoice = await createQuickBooksConsultationInvoice(agencyId, {
    customerId: qbCustomerId,
    itemId,
    description: `${appointment.subject} — consultation booking`,
    amount,
  });

  let hold;
  try {
    hold = await prisma.bookingPaymentHold.create({
      data: {
        agencyId,
        assignedToId: appointment.assignedToId,
        sessionTypeId: appointment.sessionTypeId,
        startsAt: appointment.startsAt,
        endsAt: appointment.endsAt,
        guestName: name,
        guestEmail: email || null,
        guestEmailNormalized: email?.toLowerCase() || null,
        guestPhone: phone || null,
        meetingMode: appointment.meetingMode,
        meetingPhoneNumber: appointment.meetingPhoneNumber,
        meetingProvider: appointment.meetingProvider,
        amount,
        qbCustomerId,
        qbInvoiceId: invoice.id,
        qbInvoiceNumber: invoice.docNumber,
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
  // Nothing else ever tells the client this link exists — before this, staff
  // had to read the payNowUrl off the screen and share it their own way.
  if (hold.qbInvoiceLink) {
    hold = await prisma.bookingPaymentHold.update({ where: { id: hold.id }, data: { paymentMethod: "Card" } });
    await queuePaymentHoldMessages({ agencyId, hold, actorUserId }).catch((error) => {
      logger.warn("booking_payment_hold.payment_request_message_failed", { agencyId, appointmentId: appointment.id, reason: error.message });
    });
  }
  await resolveMissingAppointmentPaymentNotification(agencyId, appointment.id).catch((error) => {
    logger.warn("booking_payment_hold.missing_payment_resolution_failed", { agencyId, appointmentId: appointment.id, reason: error.message });
  });
  invalidateDashboardCache(agencyId);
  return hold;
}

const PENDING_ETRANSFER_NOTIFICATION_TYPE = "booking_payment.etransfer_pending";
const MISSING_APPOINTMENT_PAYMENT_NOTIFICATION_TYPE = "booking_payment.appointment_missing";

function missingAppointmentPaymentWhere(agencyIds = null) {
  return {
    ...(agencyIds ? { agencyId: { in: agencyIds } } : {}),
    status: "Scheduled",
    isFreeConsultation: false,
    paymentHold: { is: null },
    // A consultation fee belongs to the first visit in a recurring series,
    // not every later occurrence (the booking controller follows the same
    // rule when it records cash/e-transfer payments).
    OR: [
      { seriesKey: null },
      { recurrenceIndex: null },
      { recurrenceIndex: 1 },
    ],
  };
}

export async function notifyMissingAppointmentPayment(agencyId, appointment, actorUserId = null) {
  if (!appointment?.id) return [];
  const recipientIds = await financialOperationsRecipientIds(agencyId);
  if (!recipientIds.length) return [];
  const clientName = appointment.client?.fullName || appointment.guestName || "A client";
  const updatedAt = new Date(appointment.updatedAt || appointment.createdAt || Date.now()).toISOString();
  return notifyUsers({
    agencyId,
    recipientIds,
    actorUserId,
    includeActor: true,
    type: MISSING_APPOINTMENT_PAYMENT_NOTIFICATION_TYPE,
    category: "payments",
    audienceKey: "finance",
    title: "Consultation payment not recorded",
    body: `${clientName}'s appointment is scheduled, but no consultation payment or payment method is recorded. Open the appointment and record the payment.`,
    severity: "warning",
    attentionLevel: "action_required",
    entityType: "appointment",
    entityId: appointment.id,
    actionUrl: `/app/calendar?appointment=${encodeURIComponent(appointment.id)}`,
    metadata: {
      appointmentId: appointment.id,
      clientId: appointment.clientId || appointment.client?.id || null,
      startsAt: appointment.startsAt || null,
    },
    // updatedAt lets a resolved warning be re-created if an appointment is
    // later re-opened as Scheduled, without re-alerting every scheduler run.
    dedupeKey: `appointment:${appointment.id}:payment_missing:${updatedAt}`,
    channels: ["in_app"],
    expiresAt: null,
  });
}

export async function resolveMissingAppointmentPaymentNotification(agencyId, appointmentId) {
  if (!appointmentId) return 0;
  return resolveNotifications({
    agencyId,
    entityType: "appointment",
    entityId: appointmentId,
    types: [MISSING_APPOINTMENT_PAYMENT_NOTIFICATION_TYPE],
  });
}

// Backfills older appointments that were booked with "Skip payment" before
// this warning existed, and clears warnings after payment is recorded, the
// appointment is made free, or it is no longer scheduled. This makes the
// alert durable without requiring a data migration or a staff page visit.
export async function reconcileMissingAppointmentPaymentAlerts() {
  const billableSettings = await prisma.bookingSettings.findMany({
    where: { consultFeeAmount: { gt: 0 } },
    select: { agencyId: true },
  });
  const billableAgencyIds = billableSettings.map((item) => item.agencyId);
  const missingAppointments = await prisma.appointment.findMany({
    where: missingAppointmentPaymentWhere(billableAgencyIds),
    select: {
      id: true,
      agencyId: true,
      clientId: true,
      guestName: true,
      startsAt: true,
      createdAt: true,
      updatedAt: true,
      client: { select: { id: true, fullName: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 2000,
  });
  for (const appointment of missingAppointments) {
    await notifyMissingAppointmentPayment(appointment.agencyId, appointment).catch((error) => {
      logger.warn("booking_payment_hold.missing_payment_notification_failed", {
        agencyId: appointment.agencyId,
        appointmentId: appointment.id,
        reason: error.message,
      });
    });
  }

  const openNotifications = await prisma.notification.findMany({
    where: { type: MISSING_APPOINTMENT_PAYMENT_NOTIFICATION_TYPE, resolvedAt: null },
    select: { agencyId: true, entityId: true },
    take: 5000,
  });
  const appointmentIds = [...new Set(openNotifications.map((item) => item.entityId).filter(Boolean))];
  if (!appointmentIds.length) return { missing: missingAppointments.length, resolved: 0 };

  const stillMissing = await prisma.appointment.findMany({
    where: { AND: [{ id: { in: appointmentIds } }, missingAppointmentPaymentWhere(billableAgencyIds)] },
    select: { id: true },
  });
  const stillMissingIds = new Set(stillMissing.map((item) => item.id));
  const stale = [...new Map(
    openNotifications
      .filter((item) => item.entityId && !stillMissingIds.has(item.entityId))
      .map((item) => [`${item.agencyId}:${item.entityId}`, item]),
  ).values()];
  let resolved = 0;
  for (const notification of stale) {
    resolved += await resolveMissingAppointmentPaymentNotification(notification.agencyId, notification.entityId);
  }
  return { missing: missingAppointments.length, resolved };
}

async function notifyPendingETransfer(agencyId, appointment, hold, actorUserId) {
  const recipientIds = await financialOperationsRecipientIds(agencyId);
  if (!recipientIds.length) return;
  const hasReference = Boolean(hold.manualPaymentReference);
  await notifyUsers({
    agencyId,
    recipientIds,
    actorUserId,
    includeActor: true,
    type: PENDING_ETRANSFER_NOTIFICATION_TYPE,
    category: "payments",
    audienceKey: "finance",
    title: hasReference ? "E-transfer could not be recorded" : "E-transfer needs attention",
    body: hasReference
      ? `${hold.guestName}'s appointment is booked, but the ${Number(hold.amount).toLocaleString("en-CA", { style: "currency", currency: "CAD" })} e-transfer could not be recorded in QuickBooks. Open the appointment, correct the issue, and retry.`
      : `${hold.guestName}'s appointment is booked, but the ${Number(hold.amount).toLocaleString("en-CA", { style: "currency", currency: "CAD" })} e-transfer is not fully recorded. Add the transaction number after payment is received.`,
    severity: "warning",
    attentionLevel: "action_required",
    entityType: "bookingPaymentHold",
    entityId: hold.id,
    actionUrl: `/app/calendar?appointment=${encodeURIComponent(appointment.id)}`,
    metadata: { appointmentId: appointment.id, holdId: hold.id, amount: Number(hold.amount), paymentError: hold.paymentError || null },
    dedupeKey: `booking_payment_hold:${hold.id}:etransfer_pending`,
    channels: ["in_app"],
    expiresAt: null,
  });
}

export async function resolvePendingETransferNotification(agencyId, holdId) {
  if (!holdId) return 0;
  return resolveNotifications({
    agencyId,
    entityType: "bookingPaymentHold",
    entityId: holdId,
    types: [PENDING_ETRANSFER_NOTIFICATION_TYPE],
  });
}

// An e-transfer may be promised before it has reached the bank account. The
// appointment is real immediately, while this non-expiring hold keeps the fee
// outstanding everywhere until staff record the transaction number (or QBO
// reconciliation observes a payment carrying one). The local row is created before any
// QuickBooks call so a provider outage can never make the debt disappear.
export async function createPendingWalkInETransfer(agencyId, { appointmentId, actorUserId }) {
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, agencyId },
    include: { client: { select: { id: true, fullName: true, email: true, phone: true } } },
  });
  if (!appointment) throw createHttpError(404, "Appointment not found.", "NOT_FOUND");
  if (appointment.isFreeConsultation) throw createHttpError(409, "This is a free consultation — no payment is needed.", "FREE_CONSULTATION");

  const existing = await prisma.bookingPaymentHold.findUnique({ where: { appointmentId } });
  if (existing) {
    await resolveMissingAppointmentPaymentNotification(agencyId, appointmentId).catch(() => {});
    return existing;
  }

  const settings = await prisma.bookingSettings.findUnique({ where: { agencyId } });
  const amount = Number(settings?.consultFeeAmount || 0);
  if (!amount) throw createHttpError(409, "Set a consultation fee in Settings before tracking an e-transfer.", "VALIDATION_ERROR");

  const name = appointment.client?.fullName || appointment.guestName;
  const email = appointment.client?.email || appointment.guestEmail;
  const phone = appointment.client?.phone || appointment.guestPhone;
  let hold;
  try {
    hold = await prisma.bookingPaymentHold.create({
      data: {
        agencyId,
        assignedToId: appointment.assignedToId,
        sessionTypeId: appointment.sessionTypeId,
        startsAt: appointment.startsAt,
        endsAt: appointment.endsAt,
        guestName: name,
        guestEmail: email || null,
        guestEmailNormalized: email?.toLowerCase() || null,
        guestPhone: phone || null,
        meetingMode: appointment.meetingMode,
        meetingPhoneNumber: appointment.meetingPhoneNumber,
        meetingProvider: appointment.meetingProvider,
        amount,
        status: "AwaitingPayment",
        source: "WalkIn",
        expiresAt: null,
        appointmentId: appointment.id,
        clientId: appointment.clientId || null,
        createdById: actorUserId,
        paymentMethod: "ETransfer",
        manualPaymentReference: null,
      },
    });
  } catch (error) {
    if (error?.code !== "P2002") throw error;
    hold = await prisma.bookingPaymentHold.findUnique({ where: { appointmentId } });
    if (!hold) throw error;
  }

  await resolveMissingAppointmentPaymentNotification(agencyId, appointment.id).catch((error) => {
    logger.warn("booking_payment_hold.missing_payment_resolution_failed", { agencyId, appointmentId: appointment.id, reason: error.message });
  });

  await notifyPendingETransfer(agencyId, appointment, hold, actorUserId).catch((error) => {
    logger.warn("booking_payment_hold.pending_etransfer_notification_failed", { agencyId, holdId: hold.id, reason: error.message });
  });
  invalidateDashboardCache(agencyId);

  let createdInvoice = null;
  let qbCustomerId = null;
  try {
    const itemId = await requireConsultFeeItem(agencyId);
    qbCustomerId = await resolveQuickBooksCustomerForBooking(agencyId, {
      clientId: appointment.clientId,
      name,
      email,
      phone,
    });
    const invoice = await createQuickBooksConsultationInvoice(agencyId, {
      customerId: qbCustomerId,
      itemId,
      description: `Consultation — ${name}`,
      amount,
      requestId: `pending-etransfer-consult-invoice-${hold.id}`,
    });
    createdInvoice = invoice;
    hold = await prisma.bookingPaymentHold.update({
      where: { id: hold.id },
      data: {
        qbCustomerId,
        qbInvoiceId: invoice.id,
        qbInvoiceNumber: invoice.docNumber,
        qbInvoiceLink: invoice.invoiceLink,
        qbSyncToken: invoice.syncToken,
        paymentError: null,
      },
    });
  } catch (error) {
    // If QuickBooks accepted the invoice but the first local patch failed,
    // retry that idempotent patch once. If the database still cannot retain
    // the invoice identifiers, void it so CaseDesk never leaves an orphaned
    // charge that reconciliation cannot find.
    if (createdInvoice?.id && qbCustomerId) {
      try {
        hold = await prisma.bookingPaymentHold.update({
          where: { id: hold.id },
          data: {
            qbCustomerId,
            qbInvoiceId: createdInvoice.id,
            qbInvoiceNumber: createdInvoice.docNumber,
            qbInvoiceLink: createdInvoice.invoiceLink,
            qbSyncToken: createdInvoice.syncToken,
            paymentError: null,
          },
        });
        logger.warn("booking_payment_hold.pending_etransfer_invoice_persist_recovered", { agencyId, holdId: hold.id, invoiceId: createdInvoice.id });
      } catch (persistError) {
        await voidQuickBooksInvoice(agencyId, { id: createdInvoice.id, syncToken: createdInvoice.syncToken }).catch((voidError) => {
          logger.warn("booking_payment_hold.pending_etransfer_void_after_persist_failure_failed", { agencyId, holdId: hold.id, invoiceId: createdInvoice.id, reason: voidError.message });
        });
        const paymentError = String(persistError?.message || error?.message || "QuickBooks invoice could not be saved in CaseDesk.").slice(0, 1000);
        hold = await prisma.bookingPaymentHold.update({
          where: { id: hold.id },
          data: { status: "PaymentFailed", paymentError },
        });
      }
    } else {
      const paymentError = String(error?.message || "QuickBooks invoice could not be created.").slice(0, 1000);
      hold = await prisma.bookingPaymentHold.update({
        where: { id: hold.id },
        data: { status: "PaymentFailed", paymentError },
      });
      logger.warn("booking_payment_hold.pending_etransfer_invoice_failed", { agencyId, holdId: hold.id, reason: paymentError });
    }
  }

  await recordActivity({
    agencyId,
    userId: actorUserId,
    clientId: appointment.clientId,
    caseId: appointment.caseId,
    action: "appointment.etransfer_payment_pending",
    details: `Appointment booked for ${hold.guestName}; the ${Number(hold.amount).toFixed(2)} e-transfer remains outstanding.`,
    entityType: "bookingPaymentHold",
    entityId: hold.id,
  }).catch(() => {});
  return hold;
}

// A real incident: the same $100 e-transfer for one appointment got
// submitted three times, because each entry point (the Calendar inline
// form, the booking-creation flow, the client account-statement billing
// sheet) only knew about its own local state, not whether another
// submission was already sitting in the approval queue. Every path that can
// start a consultation payment calls this first, so a second submission for
// the same appointment is blocked with a clear reason no matter which
// screen it comes from.
export async function assertNoLivePaymentApproval(agencyId, appointmentId, excludeApprovalId = null) {
  if (!appointmentId) return;
  const liveApproval = await prisma.paymentApproval.findFirst({
    where: {
      agencyId,
      appointmentId,
      entryType: { in: ["appointment_payment", "appointment_payment_details"] },
      status: { in: ["Pending", "Processing"] },
      ...(excludeApprovalId ? { id: { not: excludeApprovalId } } : {}),
    },
    select: { id: true },
  });
  if (liveApproval) {
    throw createHttpError(
      409,
      "A payment for this appointment has already been submitted and is awaiting review. Check Payments before submitting it again.",
      "PAYMENT_ALREADY_SUBMITTED",
    );
  }
}

// Staff collected payment outside QuickBooks' hosted checkout. The money
// still belongs in the same accounting trail as card
// payments, so this creates/reuses the consultation invoice and applies a
// real QuickBooks Payment before CaseDesk marks the hold paid.
export async function recordWalkInManualPayment(agencyId, {
  appointmentId,
  method,
  transactionReference,
  paymentDate,
  note,
  actorUserId,
  actorRole = "admin",
  overrideFreeConsultation = false,
  approvalId = null,
}) {
  if (!MANUAL_PAYMENT_METHOD_LABELS[method]) {
    throw createHttpError(400, "Choose a supported payment method.", "VALIDATION_ERROR");
  }
  const paymentReference = String(transactionReference || "").trim().slice(0, 100) || null;
  const transactionDate = normalizeManualPaymentDate(paymentDate);
  if (method !== "Cash" && !paymentReference) {
    throw createHttpError(
      400,
      method === "ETransfer" ? "Enter the e-transfer transaction number before recording the payment." : `Enter the ${MANUAL_PAYMENT_METHOD_LABELS[method].toLowerCase()} reference before recording the payment.`,
      "VALIDATION_ERROR",
    );
  }
  let appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, agencyId },
    include: { client: { select: { id: true, fullName: true, email: true, phone: true } } },
  });
  if (!appointment) throw createHttpError(404, "Appointment not found.", "NOT_FOUND");
  if (!["Scheduled", "Completed", "NoShow", "Cancelled"].includes(appointment.status)) {
    throw createHttpError(409, "This appointment cannot accept a payment record.", "INVALID_STATE");
  }
  if (appointment.isFreeConsultation && !overrideFreeConsultation) {
    throw createHttpError(409, "Confirm that this free consultation should be converted to a paid appointment before recording payment.", "FREE_CONSULTATION_CONFIRMATION_REQUIRED");
  }

  let existingHold = await prisma.bookingPaymentHold.findUnique({ where: { appointmentId } });
  if (existingHold?.status === "Paid") throw createHttpError(409, "This consultation is already marked as paid.", "ALREADY_PAID");
  if (existingHold?.status === "Refunded") throw createHttpError(409, "This consultation was already refunded. Create a new consultation charge instead of replacing its audit history.", "ALREADY_REFUNDED");
  if (existingHold?.status === "RecordingPayment") {
    throw createHttpError(409, "A payment is already being recorded for this appointment. Wait a moment and refresh before trying again.", "PAYMENT_IN_PROGRESS");
  }
  await assertNoLivePaymentApproval(agencyId, appointmentId, approvalId);
  if (existingHold?.status === "AwaitingPayment" && existingHold.qbInvoiceId) {
    await reconcilePaymentHold(agencyId, existingHold.id).catch(() => null);
    existingHold = await prisma.bookingPaymentHold.findUnique({ where: { appointmentId } });
    if (existingHold?.status === "Paid") throw createHttpError(409, "QuickBooks already shows this consultation as paid.", "ALREADY_PAID");
  }
  if (paymentReference) {
    // A voided/deleted payment keeps its old reference on record for audit
    // history, but no longer represents a real transaction — the reference
    // must be free to reuse, otherwise correcting a mistaken entry
    // permanently locks out its own real transaction number.
    const [duplicateReference, duplicateInvoiceReference] = await Promise.all([
      prisma.bookingPaymentHold.findFirst({
        where: {
          agencyId,
          manualPaymentReference: paymentReference,
          status: { notIn: ["Void", "Voided"] },
          ...(existingHold ? { id: { not: existingHold.id } } : {}),
        },
        select: { id: true },
      }),
      prisma.caseInvoice.findFirst({ where: { agencyId, lastPaymentReference: paymentReference, status: { notIn: ["Void", "Voided"] } }, select: { id: true } }),
    ]);
    if (duplicateReference || duplicateInvoiceReference) {
      throw createHttpError(
        409,
        "This transaction number is already attached to another payment.",
        "DUPLICATE_PAYMENT_REFERENCE",
      );
    }
  }

  const settings = await prisma.bookingSettings.findUnique({ where: { agencyId } });
  const amount = Number(existingHold?.amount || settings?.consultFeeAmount || 0);
  if (!amount) throw createHttpError(409, "Set a consultation fee in Settings before recording a payment.", "VALIDATION_ERROR");
  if (appointment.isFreeConsultation) {
    const [updatedAppointment] = await prisma.$transaction([
      prisma.appointment.update({
        where: { id: appointment.id },
        data: { isFreeConsultation: false },
        include: { client: { select: { id: true, fullName: true, email: true, phone: true } } },
      }),
      prisma.appointmentEvent.create({
        data: {
          agencyId,
          appointmentId: appointment.id,
          actorUserId: actorUserId || null,
          type: "payment.free_consultation_overridden",
          summary: "Free consultation converted to a paid appointment",
          metadata: { source: "client_billing_manual_entry" },
        },
      }),
    ]);
    appointment = updatedAppointment;
    await recordActivity({
      agencyId,
      userId: actorUserId,
      clientId: appointment.clientId,
      caseId: appointment.caseId,
      action: "appointment.free_consultation_overridden",
      details: "Free consultation converted to a paid appointment before manual payment was recorded.",
      entityType: "appointment",
      entityId: appointment.id,
    }).catch(() => {});
  }
  const name = appointment.client?.fullName || appointment.guestName;
  const email = appointment.client?.email || appointment.guestEmail;
  const phone = appointment.client?.phone || appointment.guestPhone;
  let hold = existingHold;
  if (!hold) {
    hold = await prisma.bookingPaymentHold.create({
      data: {
        agencyId,
        assignedToId: appointment.assignedToId,
        sessionTypeId: appointment.sessionTypeId,
        startsAt: appointment.startsAt,
        endsAt: appointment.endsAt,
        guestName: name,
        guestEmail: email || null,
        guestEmailNormalized: email?.toLowerCase() || null,
        guestPhone: phone || null,
        meetingMode: appointment.meetingMode,
        meetingPhoneNumber: appointment.meetingPhoneNumber,
        meetingProvider: appointment.meetingProvider,
        amount,
        status: "RecordingPayment",
        source: "WalkIn",
        expiresAt: null,
        appointmentId: appointment.id,
        clientId: appointment.clientId || null,
        createdById: actorUserId,
        paymentMethod: method,
        manualPaymentReference: paymentReference,
        manualPaymentNote: String(note || "").trim().slice(0, 500) || null,
      },
    });
  } else {
    hold = await prisma.bookingPaymentHold.update({
      where: { id: hold.id },
      data: {
        status: "RecordingPayment",
        paymentMethod: method,
        manualPaymentReference: paymentReference,
        manualPaymentNote: String(note || "").trim().slice(0, 500) || null,
        paymentError: null,
        clientId: appointment.clientId || hold.clientId,
      },
    });
  }

  await resolveMissingAppointmentPaymentNotification(agencyId, appointment.id).catch((error) => {
    logger.warn("booking_payment_hold.missing_payment_resolution_failed", { agencyId, appointmentId: appointment.id, reason: error.message });
  });
  invalidateDashboardCache(agencyId);

  // Cash is intentionally a CaseDesk-only payment. It never creates a
  // QuickBooks Payment or payment method. The booking hold remains the
  // appointment's paid snapshot, while PaymentApproval is the audit ledger.
  if (method === "Cash") {
    hold = await prisma.bookingPaymentHold.update({
      where: { id: hold.id },
      data: {
        status: "Paid",
        paidAt: transactionDate?.paidAt || new Date(),
        paymentMethod: "Cash",
        manualPaymentReference: paymentReference,
        manualPaymentNote: String(note || "").trim().slice(0, 500) || null,
        paymentError: null,
        qbPaymentId: null,
        clientId: appointment.clientId || hold.clientId,
      },
    });
    if (!approvalId) {
      await createApprovedCashLedgerRecord({
        agencyId,
        clientId: appointment.clientId,
        caseId: appointment.caseId,
        appointmentId: appointment.id,
        entryType: "appointment_payment",
        amount,
        description: appointment.subject || "Consultation payment",
        transactionReference: paymentReference,
        paymentDate: paymentDate || new Date().toISOString().slice(0, 10),
        note,
        actorUserId,
        sourceRole: actorRole,
        idempotencyKey: `appointment-cash:${appointment.id}`,
      });
    }
    await recordActivity({
      agencyId,
      userId: actorUserId,
      clientId: appointment.clientId,
      caseId: appointment.caseId,
      action: "invoice.manual_payment_recorded",
      details: `Consultation cash payment ($${Number(amount).toFixed(2)}) recorded in CaseDesk only for ${hold.guestName}${note ? ` — ${note}` : ""}`,
      entityType: "bookingPaymentHold",
      entityId: hold.id,
      metadata: { method: "Cash", quickBooksStored: false, approvalId },
    }).catch(() => {});
    await syncLeadConsultationPaymentFromEvidence(agencyId, appointment.id, "Paid").catch(() => {});
    invalidateDashboardCache(agencyId);
    return hold;
  }

  try {
    const itemId = await requireConsultFeeItem(agencyId);
    const qbCustomerId = hold.qbCustomerId || await resolveQuickBooksCustomerForBooking(agencyId, {
      clientId: appointment.clientId,
      name,
      email,
      phone,
    });
    hold = await prisma.bookingPaymentHold.update({
      where: { id: hold.id },
      data: { qbCustomerId },
    });

    let invoice = null;
    if (hold.qbInvoiceId && !hold.voidedAt) {
      invoice = await getQuickBooksInvoice(agencyId, hold.qbInvoiceId).catch(() => null);
      if (invoice?.isVoided) invoice = null;
    }
    if (!invoice) {
      invoice = await createQuickBooksConsultationInvoice(agencyId, {
        customerId: qbCustomerId,
        itemId,
        description: `Consultation — ${name}`,
        amount,
        requestId: `manual-consult-invoice-${hold.id}`,
      });
      hold = await prisma.bookingPaymentHold.update({
        where: { id: hold.id },
        data: {
          qbCustomerId,
          qbInvoiceId: invoice.id,
          qbInvoiceNumber: invoice.docNumber,
          qbInvoiceLink: invoice.invoiceLink,
          qbSyncToken: invoice.syncToken,
          voidedAt: null,
        },
      });
    }
    if (Number(invoice.balance) <= 0) {
      throw createHttpError(409, "QuickBooks already shows this consultation invoice as paid. Refresh payments before recording another payment.", "ALREADY_PAID");
    }
    const paymentAmount = Number(invoice.balance);
    const methodName = MANUAL_PAYMENT_METHOD_LABELS[method];
    const qboMethod = await findOrCreateQuickBooksPaymentMethod(agencyId, methodName);
    const payment = await createQuickBooksReceivePayment(agencyId, {
      customerId: qbCustomerId,
      invoiceId: invoice.id,
      amount: paymentAmount,
      paymentMethodId: qboMethod.id,
      paymentReference: paymentReference || `CD-${hold.id.slice(0, 8)}`,
      transactionDate: transactionDate?.qboDate,
      privateNote: `CaseDesk consultation payment — ${methodName}${paymentReference ? ` — transaction ${paymentReference}` : ""}${note ? ` — ${String(note).trim().slice(0, 300)}` : ""}`,
      requestId: `manual-consult-pay-${hold.id}`,
    });

    hold = await prisma.bookingPaymentHold.update({
      where: { id: hold.id },
      data: {
        status: "Paid",
        paidAt: transactionDate?.paidAt || new Date(),
        qbPaymentId: payment.id,
        paymentMethod: method,
        manualPaymentReference: paymentReference,
        manualPaymentNote: String(note || "").trim().slice(0, 500) || null,
        paymentError: null,
        clientId: appointment.clientId || hold.clientId,
        qbCustomerId,
        voidedAt: null,
      },
    });

    await resolvePendingETransferNotification(agencyId, hold.id).catch((error) => {
      logger.warn("booking_payment_hold.pending_etransfer_resolution_failed", { agencyId, holdId: hold.id, reason: error.message });
    });
    invalidateDashboardCache(agencyId);

    const methodLabel = methodName.toLowerCase();
    await recordActivity({
      agencyId,
      userId: actorUserId,
      clientId: appointment.clientId,
      caseId: null,
      action: "invoice.manual_payment_recorded",
      details: `Consultation payment ($${paymentAmount.toFixed(2)}) recorded by ${methodLabel} for ${hold.guestName}${paymentReference ? ` — transaction ${paymentReference}` : ""}${note ? ` — ${note}` : ""}`,
      entityType: "bookingPaymentHold",
      entityId: hold.id,
      metadata: { method, transactionReference: paymentReference, note: note || null },
    }).catch(() => {});

    await syncLeadConsultationPaymentFromEvidence(agencyId, appointment.id, "Paid").catch(() => {});

    return hold;
  } catch (error) {
    const paymentError = String(error?.message || "Could not record this payment.").slice(0, 1000);
    await prisma.bookingPaymentHold.update({
      where: { id: hold.id },
      data: {
        status: "PaymentFailed",
        paymentMethod: method,
        manualPaymentReference: paymentReference,
        paymentError,
      },
    }).catch(() => {});
    if (method === "ETransfer") {
      await notifyPendingETransfer(agencyId, appointment, { ...hold, status: "PaymentFailed", paymentError }, actorUserId).catch((notifyError) => {
        logger.warn("booking_payment_hold.failed_etransfer_notification_failed", { agencyId, holdId: hold.id, reason: notifyError.message });
      });
    }
    await recordActivity({
      agencyId,
      userId: actorUserId,
      clientId: appointment.clientId,
      caseId: null,
      action: "invoice.manual_payment_failed",
      details: `Consultation payment could not be recorded for ${hold.guestName}: ${paymentError}`,
      entityType: "bookingPaymentHold",
      entityId: hold.id,
      metadata: { method, transactionReference: paymentReference },
    }).catch(() => {});
    throw error;
  }
}

function normalizeManualPaymentDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw createHttpError(400, "Choose a valid payment date.", "VALIDATION_ERROR");
  const [, year, month, day] = match.map(Number);
  const paidAt = new Date(Date.UTC(year, month - 1, day, 12));
  if (paidAt.getUTCFullYear() !== year || paidAt.getUTCMonth() !== month - 1 || paidAt.getUTCDate() !== day) {
    throw createHttpError(400, "Choose a valid payment date.", "VALIDATION_ERROR");
  }
  if (text > new Date().toISOString().slice(0, 10)) {
    throw createHttpError(400, "The payment date cannot be in the future.", "VALIDATION_ERROR");
  }
  return { qboDate: text, paidAt };
}

export async function updatePaidAppointmentPaymentDetails(agencyId, {
  appointmentId,
  method,
  transactionReference,
  paymentDate,
  actorUserId,
  actorRole = "admin",
  approvalId = null,
}) {
  if (!MANUAL_PAYMENT_METHOD_LABELS[method]) {
    throw createHttpError(400, "Choose a supported payment method.", "VALIDATION_ERROR");
  }
  const paymentReference = String(transactionReference || "").trim().slice(0, 100) || null;
  if (method !== "Cash" && !paymentReference) {
    throw createHttpError(400, method === "ETransfer" ? "Enter the e-transfer transaction number." : `Enter the ${MANUAL_PAYMENT_METHOD_LABELS[method].toLowerCase()} reference.`, "VALIDATION_ERROR");
  }
  const transactionDate = normalizeManualPaymentDate(paymentDate);
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, agencyId },
    include: { paymentHold: true },
  });
  if (!appointment) throw createHttpError(404, "Appointment not found.", "NOT_FOUND");
  const hold = appointment.paymentHold;
  if (!hold) {
    throw createHttpError(409, "Record the appointment payment before adding its transaction details.", "PAYMENT_NOT_RECORDED");
  }
  if (hold.status === "Refunded") throw createHttpError(409, "Refunded payment details cannot be changed.", "ALREADY_REFUNDED");
  if (hold.status !== "Paid") {
    throw createHttpError(409, "Record the appointment payment before adding its transaction details.", "PAYMENT_NOT_RECORDED");
  }

  if (paymentReference) {
    const [bookingDuplicate, invoiceDuplicate] = await Promise.all([
      prisma.bookingPaymentHold.findFirst({ where: { agencyId, manualPaymentReference: paymentReference, status: { notIn: ["Void", "Voided"] }, id: { not: hold.id } }, select: { id: true } }),
      prisma.caseInvoice.findFirst({ where: { agencyId, lastPaymentReference: paymentReference, status: { notIn: ["Void", "Voided"] } }, select: { id: true } }),
    ]);
    if (bookingDuplicate || invoiceDuplicate) {
      throw createHttpError(409, "This transaction number is already attached to another payment.", "DUPLICATE_PAYMENT_REFERENCE");
    }
  }

  if (method === "Cash") {
    if (hold.qbPaymentId) {
      throw createHttpError(409, "This payment already exists in QuickBooks and cannot be reclassified as CaseDesk-only cash.", "QBO_PAYMENT_ALREADY_EXISTS");
    }
    const updated = await prisma.bookingPaymentHold.update({
      where: { id: hold.id },
      data: {
        paymentMethod: "Cash",
        manualPaymentReference: paymentReference,
        ...(transactionDate ? { paidAt: transactionDate.paidAt } : {}),
      },
    });
    if (!approvalId) {
      await createApprovedCashLedgerRecord({
        agencyId,
        clientId: appointment.clientId,
        caseId: appointment.caseId,
        appointmentId,
        entryType: "appointment_payment_details",
        amount: Number(hold.amount),
        description: appointment.subject || "Consultation payment",
        transactionReference: paymentReference,
        paymentDate: paymentDate || new Date().toISOString().slice(0, 10),
        actorUserId,
        sourceRole: actorRole,
        idempotencyKey: `appointment-cash:${appointmentId}`,
      });
    }
    await recordActivity({
      agencyId,
      userId: actorUserId,
      clientId: appointment.clientId,
      caseId: appointment.caseId,
      action: "invoice.manual_payment_details_updated",
      details: `CaseDesk-only cash details updated for ${appointment.subject}`,
      entityType: "bookingPaymentHold",
      entityId: hold.id,
      metadata: { method: "Cash", quickBooksStored: false, approvalId },
    });
    return updated;
  }

  const qbPaymentId = hold.qbPaymentId || await findQuickBooksPaymentIdForInvoice(agencyId, hold.qbCustomerId, hold.qbInvoiceId);
  if (!qbPaymentId) {
    throw createHttpError(409, "The matching QuickBooks payment could not be found. Refresh billing and try again.", "QBO_PAYMENT_NOT_FOUND");
  }
  const methodName = MANUAL_PAYMENT_METHOD_LABELS[method];
  const qboMethod = await findOrCreateQuickBooksPaymentMethod(agencyId, methodName);
  await updateQuickBooksPaymentDetails(agencyId, {
    id: qbPaymentId,
    paymentReference,
    paymentMethodId: qboMethod.id,
    transactionDate: transactionDate?.qboDate,
  });
  const updated = await prisma.bookingPaymentHold.update({
    where: { id: hold.id },
    data: {
      qbPaymentId,
      paymentMethod: method,
      manualPaymentReference: paymentReference,
      ...(transactionDate ? { paidAt: transactionDate.paidAt } : {}),
    },
  });
  await resolvePendingETransferNotification(agencyId, hold.id).catch((error) => {
    logger.warn("booking_payment_hold.pending_etransfer_resolution_failed", { agencyId, holdId: hold.id, reason: error.message });
  });
  await recordActivity({
    agencyId,
    userId: actorUserId,
    clientId: appointment.clientId,
    caseId: appointment.caseId,
    action: "invoice.manual_payment_details_updated",
    details: `${methodName} details updated for ${appointment.subject}${paymentReference ? ` — transaction ${paymentReference}` : ""}`,
    entityType: "bookingPaymentHold",
    entityId: hold.id,
    metadata: { method, transactionReference: paymentReference, paymentDate: transactionDate?.qboDate || null, qbPaymentId },
  });
  return updated;
}

// Cancelling an appointment that still has a pending
// (unpaid) payment hold previously left that hold and its QuickBooks
// invoice open forever — nothing ever revisited it once the appointment
// itself was closed out. Called from the appointment cancel/status-update
// paths. Deliberately NOT called for "Completed" or "NoShow" — if the
// consultation happened or the client missed it, the fee can still be owed
// under the consultation terms and should stay open for staff to resolve.
// Best-effort by design: a QuickBooks hiccup here must never block the
// appointment status change itself.
export async function voidOpenPaymentHoldForAppointment(agencyId, appointmentId) {
  const hold = await prisma.bookingPaymentHold.findUnique({ where: { appointmentId } });
  const safelyUnpaid = hold?.status === "AwaitingPayment" || (
    hold?.status === "PaymentFailed" &&
    hold.paymentMethod === "ETransfer" &&
    !hold.manualPaymentReference &&
    !hold.qbPaymentId
  );
  if (!hold || !safelyUnpaid) return null;
  if (hold.qbInvoiceId) {
    await voidQuickBooksInvoice(agencyId, { id: hold.qbInvoiceId, syncToken: hold.qbSyncToken }).catch((error) => {
      logger.warn("booking_payment_hold.void_on_appointment_closed_failed", { agencyId, holdId: hold.id, reason: error.message });
    });
  }
  const updated = await prisma.bookingPaymentHold.update({ where: { id: hold.id }, data: { status: "Voided", voidedAt: new Date() } });
  await resolvePendingETransferNotification(agencyId, hold.id).catch(() => {});
  invalidateDashboardCache(agencyId);
  return updated;
}

export async function resendPaymentHoldRequest(agencyId, holdId, { email = null, phone = undefined, actorUserId = null } = {}) {
  let hold = await prisma.bookingPaymentHold.findFirst({ where: { id: holdId, agencyId } });
  if (!hold) throw createHttpError(404, "This payment reservation was not found.", "NOT_FOUND");
  if (hold.status === "AwaitingPayment" && hold.qbInvoiceId) {
    // Never send a second "please pay" message while QuickBooks is
    // unreachable: the invoice may already be paid and awaiting sync.
    await reconcilePaymentHold(agencyId, hold.id, { force: true });
    hold = await prisma.bookingPaymentHold.findFirst({ where: { id: holdId, agencyId } });
  }
  if (hold.status !== "AwaitingPayment") {
    throw createHttpError(409, hold.status === "Paid" ? "This reservation is already paid and confirmed." : "This payment request is no longer active.", "INVALID_STATE");
  }
  if (hold.expiresAt && hold.expiresAt <= new Date()) {
    throw createHttpError(409, "This reservation has expired. Choose a new available time instead.", "HOLD_EXPIRED");
  }
  if (!hold.qbInvoiceLink) throw createHttpError(409, "This reservation does not have an active payment link.", "PAYMENT_LINK_UNAVAILABLE");

  const nextEmail = email == null ? hold.guestEmail : String(email).trim().toLowerCase().slice(0, 254);
  const nextPhone = phone === undefined ? hold.guestPhone : String(phone || "").trim().slice(0, 40) || null;
  if (!nextEmail && !nextPhone) throw createHttpError(400, "Enter an email address or phone number for the payment request.", "VALIDATION_ERROR");

  await prisma.bookingMessageDelivery.updateMany({
    where: { paymentHoldId: hold.id, kind: "payment_requested", status: { in: ["pending", "processing"] } },
    data: { status: "cancelled", failedAt: null, lastError: null },
  });
  hold = await prisma.bookingPaymentHold.update({
    where: { id: hold.id },
    data: { guestEmail: nextEmail || null, guestEmailNormalized: nextEmail || null, guestPhone: nextPhone },
  });
  const delivery = await queuePaymentHoldMessages({ agencyId, hold, actorUserId, dedupeSuffix: `resend-${Date.now()}` });
  await recordActivity({
    agencyId,
    userId: actorUserId,
    clientId: hold.clientId,
    action: "appointment.payment_request_resent",
    details: `Consultation payment request resent by ${[nextEmail ? "email" : null, nextPhone ? "SMS" : null].filter(Boolean).join(" and ")}`,
    entityType: "bookingPaymentHold",
    entityId: hold.id,
  }).catch(() => {});
  return { ...hold, delivery };
}

export async function cancelPaymentHoldRequest(agencyId, holdId, { actorUserId = null } = {}) {
  let hold = await prisma.bookingPaymentHold.findFirst({ where: { id: holdId, agencyId } });
  if (!hold) throw createHttpError(404, "This payment reservation was not found.", "NOT_FOUND");
  if (hold.status === "AwaitingPayment" && hold.qbInvoiceId) {
    await reconcilePaymentHold(agencyId, hold.id, { force: true });
    hold = await prisma.bookingPaymentHold.findFirst({ where: { id: holdId, agencyId } });
  }
  if (hold.status !== "AwaitingPayment") {
    throw createHttpError(409, hold.status === "Paid" ? "Payment has already completed, so this reservation cannot be cancelled." : "This payment request is no longer active.", "INVALID_STATE");
  }
  if (hold.qbInvoiceId) {
    await voidQuickBooksInvoice(agencyId, { id: hold.qbInvoiceId, syncToken: hold.qbSyncToken });
  }
  const changed = await prisma.bookingPaymentHold.updateMany({
    where: { id: hold.id, status: "AwaitingPayment" },
    data: { status: "Voided", voidedAt: new Date() },
  });
  if (changed.count !== 1) throw createHttpError(409, "The payment status changed while cancelling. Refresh and check it again.", "STATE_CHANGED");
  await prisma.bookingMessageDelivery.updateMany({
    where: { paymentHoldId: hold.id, kind: "payment_requested", status: { in: ["pending", "processing"] } },
    data: { status: "cancelled", failedAt: null, lastError: null },
  });
  await recordActivity({
    agencyId,
    userId: actorUserId,
    clientId: hold.clientId,
    action: "appointment.payment_request_cancelled",
    details: `Consultation payment reservation cancelled for ${hold.guestName}`,
    entityType: "bookingPaymentHold",
    entityId: hold.id,
  }).catch(() => {});
  return { ...(await prisma.bookingPaymentHold.findUnique({ where: { id: hold.id } })), delivery: await paymentHoldDeliverySummary(hold.id) };
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
  const recipientIds = await financialOperationsRecipientIds(hold.agencyId);
  if (!recipientIds.length) return;
  await notifyUsers({
    agencyId: hold.agencyId,
    recipientIds,
    type: "booking_payment.expired",
    category: "payments",
    audienceKey: "finance",
    title: "Consultation payment not completed",
    body: `${hold.guestName} did not finish paying for their ${new Date(hold.startsAt).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })} consultation ($${Number(hold.amount).toFixed(2)}) — the hold expired and the slot has been released.`,
    severity: "warning",
    entityType: "bookingPaymentHold",
    entityId: hold.id,
    actionUrl: `/app/payments?source=booking_payment&hold=${encodeURIComponent(hold.id)}`,
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
    await captureAbandonedPublicBookingLead(hold.agencyId, hold.id).catch((error) => {
      logger.warn("booking_payment_hold.abandoned_lead_capture_failed", { agencyId: hold.agencyId, holdId: hold.id, reason: error.message });
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

// A hold only ever leaves "Paid" through a matching QuickBooks RefundReceipt
// (see applyBookingRefundReceipt in quickbooksWebhookService.js) — that's
// the only reversal path anything here ever watches for. Deleting the
// Payment transaction directly in QuickBooks (instead of refunding it)
// produces no RefundReceipt and no usable webhook (the Payment is gone by
// the time the event is processed, so the lookup to find its invoice fails
// and the event is silently ignored) — so a hold can go on showing "Paid"
// indefinitely with no signal anything changed. This sweep is the backstop:
// periodically re-check each recently-paid hold's real invoice balance and
// flag the mismatch for a human, since there's no way to know *why* the
// balance changed (deleted payment vs. something else) from here.
const BALANCE_MISMATCH_POLL_MS = 30 * 60_000;
const BALANCE_MISMATCH_WINDOW_DAYS = 30;
let balanceMismatchTimer = null;

async function notifyBalanceMismatch(hold, invoice) {
  const recipientIds = await financialOperationsRecipientIds(hold.agencyId);
  if (!recipientIds.length) return;
  await notifyUsers({
    agencyId: hold.agencyId,
    recipientIds,
    type: "booking_payment.balance_mismatch",
    category: "payments",
    audienceKey: "finance",
    title: "A paid consultation no longer shows as paid in QuickBooks",
    body: `${hold.guestName}'s $${Number(hold.amount).toFixed(2)} consultation payment shows as collected in CaseDesk, but ${invoice ? `the QuickBooks invoice now has a balance of $${Number(invoice.balance).toFixed(2)}` : "its QuickBooks invoice no longer exists"}. This usually means the payment was deleted in QuickBooks rather than refunded — check and refund or re-collect as appropriate.`,
    severity: "critical",
    entityType: "bookingPaymentHold",
    entityId: hold.id,
    actionUrl: `/app/payments?source=booking_payment&hold=${encodeURIComponent(hold.id)}`,
    metadata: { holdId: hold.id, amount: Number(hold.amount), guestName: hold.guestName, qbInvoiceId: hold.qbInvoiceId },
    dedupeKey: `booking_payment_hold:${hold.id}:balance_mismatch`,
    channels: ["in_app"],
  });
}

export async function detectPaidHoldBalanceMismatches() {
  const holds = await prisma.bookingPaymentHold.findMany({
    where: {
      status: "Paid",
      qbInvoiceId: { not: null },
      // Approved cash is deliberately local-only. An older checkout invoice
      // may still exist, but its balance is not evidence that the CaseDesk
      // cash record was reversed.
      OR: [{ paymentMethod: { not: "Cash" } }, { qbPaymentId: { not: null } }],
      paidAt: { gte: new Date(Date.now() - BALANCE_MISMATCH_WINDOW_DAYS * 86_400_000) },
    },
    take: 100,
  });
  let flagged = 0;
  for (const hold of holds) {
    let invoice;
    try {
      invoice = await getQuickBooksInvoice(hold.agencyId, hold.qbInvoiceId);
    } catch (error) {
      logger.warn("booking_payment_hold.balance_mismatch_check_failed", { agencyId: hold.agencyId, holdId: hold.id, reason: error.message });
      continue;
    }
    const hasMismatch = !invoice || Number(invoice.balance) > 0;
    if (invoice && (hold.qbInvoiceNumber !== invoice.docNumber || hold.qbSyncToken !== invoice.syncToken)) {
      await prisma.bookingPaymentHold.update({
        where: { id: hold.id },
        data: { qbInvoiceNumber: invoice.docNumber, qbSyncToken: invoice.syncToken },
      });
    }
    if (hasMismatch && !hold.balanceMismatchAt) {
      await prisma.bookingPaymentHold.update({ where: { id: hold.id }, data: { balanceMismatchAt: new Date() } });
      await notifyBalanceMismatch(hold, invoice).catch((error) => {
        logger.warn("booking_payment_hold.balance_mismatch_notify_failed", { agencyId: hold.agencyId, holdId: hold.id, reason: error.message });
      });
      flagged += 1;
    } else if (!hasMismatch && hold.balanceMismatchAt) {
      // The balance is whole again (e.g. the payment was re-added) — clear
      // the flag rather than leave a stale warning around.
      await prisma.bookingPaymentHold.update({ where: { id: hold.id }, data: { balanceMismatchAt: null } });
    }
  }
  return { checked: holds.length, flagged };
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
  if (!balanceMismatchTimer) {
    balanceMismatchTimer = setInterval(() => {
      detectPaidHoldBalanceMismatches().catch((error) => logger.warn("booking_payment_hold.balance_mismatch_pass_failed", { reason: error.message }));
    }, BALANCE_MISMATCH_POLL_MS);
    if (balanceMismatchTimer.unref) balanceMismatchTimer.unref();
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
  if (balanceMismatchTimer) clearInterval(balanceMismatchTimer);
  balanceMismatchTimer = null;
}
