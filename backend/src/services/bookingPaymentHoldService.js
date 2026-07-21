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
  meetingMode,
  location,
  name,
  email,
  phone,
  notes,
  amount,
  holdMinutes,
  idempotencyKey,
  bufferMinutes,
}) {
  const itemId = await requireConsultFeeItem(agencyId);

  const holdRow = await prisma.$transaction(async (tx) => {
    await lockSchedulingTransaction(tx, agencyId, startsAt);
    const assignee = await chooseAppointmentAssignee({
      agencyId,
      sessionTypeId,
      startsAt,
      endsAt,
      requestedUserId: requestedConsultantId,
      publicOnly: true,
      bufferMinutes,
      db: tx,
    });
    const conflict = await assertSlotAvailable(tx, { agencyId, assignedToId: assignee.id, startsAt, endsAt, bufferMinutes });
    if (conflict) throw createHttpError(409, "That time was just taken. Pick another slot.", "SLOT_TAKEN");

    return tx.bookingPaymentHold.create({
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
        meetingMode,
        locationId: location?.id || null,
        notes: notes || null,
        amount,
        expiresAt: new Date(Date.now() + holdMinutes * 60_000),
      },
    });
  });

  let holdDeleted = false;
  async function releaseHold() {
    if (holdDeleted) return;
    holdDeleted = true;
    await prisma.bookingPaymentHold.delete({ where: { id: holdRow.id } }).catch(() => {});
  }

  try {
    const qbCustomerId = await resolveOrCreateQuickBooksCustomer(agencyId, { name, email, phone });
    const invoice = await createQuickBooksInvoice(agencyId, {
      customerId: qbCustomerId,
      itemId,
      description: `${sessionTypeName} — consultation booking`,
      amount,
    });
    if (!invoice.invoiceLink) {
      await voidQuickBooksInvoice(agencyId, { id: invoice.id, syncToken: invoice.syncToken }).catch((error) => {
        logger.warn("booking_payment_hold.void_after_no_link_failed", { agencyId, holdId: holdRow.id, reason: error.message });
      });
      await releaseHold();
      throw createHttpError(409, "Online card payment is not available yet — QuickBooks Payments must be enabled on the connected company.", "QBO_PAYMENTS_NOT_ENABLED");
    }
    return await prisma.bookingPaymentHold.update({
      where: { id: holdRow.id },
      data: { qbCustomerId, qbInvoiceId: invoice.id, qbInvoiceLink: invoice.invoiceLink, qbSyncToken: invoice.syncToken },
    });
  } catch (error) {
    await releaseHold();
    throw error;
  }
}

export async function getPaymentHoldStatus(agencyId, claimToken) {
  const hold = await prisma.bookingPaymentHold.findFirst({ where: { agencyId, claimToken } });
  if (!hold) throw createHttpError(404, "This booking could not be found.", "NOT_FOUND");
  return hold;
}

// ---------- Expiry + void cleanup ----------
//
// Slot release never depends on this: assertSlotAvailable/availabilityForRange
// only ever count a hold as blocking while status is "AwaitingPayment" AND
// expiresAt is still in the future, so an expired hold stops blocking the
// instant its clock runs out — independent of whether this worker has run,
// or whether QuickBooks is even reachable. This worker's only job is
// bookkeeping: mark the row Expired and best-effort void the abandoned
// invoice so it doesn't sit Open in QuickBooks forever.

const HOLD_EXPIRY_POLL_MS = 60_000;
const VOID_RETRY_POLL_MS = 15 * 60_000;
const MAX_VOID_ATTEMPTS = 5;
let holdExpiryTimer = null;
let voidRetryTimer = null;

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
    const updated = await prisma.bookingPaymentHold.update({ where: { id: hold.id }, data: { status: "Expired" } });
    await attemptVoid(updated);
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
  for (const hold of pending) await attemptVoid(hold);
  return pending.length;
}

export function startPaymentHoldExpiryWorker() {
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
}

export function stopPaymentHoldExpiryWorker() {
  if (holdExpiryTimer) clearInterval(holdExpiryTimer);
  holdExpiryTimer = null;
  if (voidRetryTimer) clearInterval(voidRetryTimer);
  voidRetryTimer = null;
}
