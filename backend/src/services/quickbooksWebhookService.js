import { randomUUID } from "node:crypto";
import prisma from "./prisma/client.js";
import { logger } from "./logger.js";
import { recordActivity } from "../utils/prismaCrud.js";
import {
  getQuickBooksInvoice,
  getQuickBooksPayment,
  getQuickBooksRefundReceipt,
  listQuickBooksRefundReceiptsSince,
} from "./quickbooksService.js";
import { assertSlotAvailable } from "./bookingAvailabilityService.js";
import { sendBookingMessages } from "./bookingNotificationService.js";
import { appointmentReference, recordAppointmentEvent } from "./appointmentOperationsService.js";
import { invalidateDashboardCache } from "./dashboardCache.js";
import { createOrLinkLeadForPaidConsultation } from "../modules/leads/lead.booking.js";
import { deriveCaseInvoiceStatus } from "./caseInvoiceService.js";
import { notifyUsers, schedulingCoordinatorRecipientIds } from "./notificationService.js";

// Deliberately not as fast as it could be: the frontend polls the hold's
// own status endpoint independently every few seconds regardless, so this
// interval only affects how quickly the *server* notices a webhook, not
// how quickly the client sees a result. With a very small DB connection
// pool (see DATABASE_URL connection_limit), an aggressive interval here
// competes with every other background worker and live request for the
// same handful of connections — 30s keeps this worker's footprint modest.
const EVENT_POLL_MS = Math.max(Number(process.env.QBO_WEBHOOK_POLL_MS) || 30_000, 10_000);
const RECONCILE_COOLDOWN_MS = Math.max(Number(process.env.QBO_HOLD_RECONCILE_COOLDOWN_MS) || 10_000, 5_000);
const BATCH_SIZE = 20;
let eventTimer = null;
const reconciliationChecks = new Map();
const reconciliationInFlight = new Map();
const refundReconciliationChecks = new Map();
const refundReconciliationInFlight = new Map();

function meetingLink() {
  return `https://meet.jit.si/CaseDesk-${randomUUID().replace(/-/g, "").slice(0, 14)}`;
}

// A client paid, but by the time we could confirm it the slot they paid
// for was gone (hold expired and someone else booked it, or a genuine
// double-confirmation race). There is no way to create the appointment
// they paid for, and no automated refund capability (QuickBooks Payments
// API access isn't part of this app's OAuth scope) — this needs a human,
// immediately, not buried in the payments list.
async function notifyOrphanedPayment(hold) {
  const recipientIds = await schedulingCoordinatorRecipientIds(hold.agencyId);
  if (!recipientIds.length) return;
  await notifyUsers({
    agencyId: hold.agencyId,
    recipientIds,
    type: "booking_payment.orphaned",
    category: "appointments",
    title: "Paid consultation has no appointment",
    body: `${hold.guestName} paid $${Number(hold.amount).toFixed(2)} for a consultation, but the slot was no longer available when the payment confirmed. Book them into a new slot manually, or refund in QuickBooks if they no longer want one.`,
    severity: "critical",
    entityType: "bookingPaymentHold",
    entityId: hold.id,
    actionUrl: "/app/payments",
    metadata: { holdId: hold.id, amount: Number(hold.amount), guestName: hold.guestName, guestEmail: hold.guestEmail, guestPhone: hold.guestPhone },
    dedupeKey: `booking_payment_hold:${hold.id}:orphaned`,
    channels: ["in_app"],
  });
}

// Fast path called directly from the webhook HTTP handler: record one row
// per notified entity and return immediately. All real processing (QBO
// re-fetches, the confirm transaction) happens later in the poll worker,
// so a slow/failing confirm never risks Intuit's webhook delivery timeout.
export async function recordWebhookEvent({ realmId, entities }) {
  if (!entities?.length) return;
  const settings = await prisma.agencyQuickBooksSettings.findUnique({ where: { realmId }, select: { agencyId: true } });
  await prisma.quickBooksWebhookEvent.createMany({
    data: entities.map((entity) => ({
      agencyId: settings?.agencyId || null,
      realmId,
      entityName: entity.name,
      entityId: entity.id,
      operation: entity.operation,
      rawPayload: entity.rawPayload || entity,
    })),
  });
}

async function claimEvent(id) {
  const result = await prisma.quickBooksWebhookEvent.updateMany({
    where: { id, status: "PENDING" },
    data: { status: "PROCESSING", lockedAt: new Date() },
  });
  return result.count === 1;
}

async function failEvent(event, error) {
  const attempts = event.attempts + 1;
  const terminal = attempts >= event.maxAttempts;
  await prisma.quickBooksWebhookEvent.update({
    where: { id: event.id },
    data: {
      status: terminal ? "FAILED" : "PENDING",
      attempts,
      lockedAt: null,
      lastError: String(error.message || error).slice(0, 500),
      availableAt: terminal ? event.availableAt : new Date(Date.now() + Math.min(2 ** attempts, 30) * 60_000),
    },
  });
  logger.warn("quickbooks_webhook.event_failed", { eventId: event.id, attempts, terminal, reason: error.message });
}

async function resolveInvoiceIdsForEvent(event) {
  if (event.entityName === "Payment") {
    try {
      const payment = await getQuickBooksPayment(event.agencyId, event.entityId);
      return payment.invoiceIds;
    } catch {
      return [];
    }
  }
  if (event.entityName === "Invoice") return [event.entityId];
  return [];
}

async function notifyAmbiguousRefund(agencyId, refund, candidates) {
  const recipientIds = await schedulingCoordinatorRecipientIds(agencyId);
  if (!recipientIds.length) return;
  const names = [...new Set(candidates.map((item) => item.guestName))].join(", ");
  await notifyUsers({
    agencyId,
    recipientIds,
    type: "booking_payment.refund_ambiguous",
    category: "appointments",
    title: "A refund could not be auto-matched to a booking",
    body: `A $${Number(refund.totalAmount).toFixed(2)} refund in QuickBooks matches ${candidates.length} paid consultations with the same amount and customer (${names}) — pick the right one manually and mark it refunded.`,
    severity: "warning",
    entityType: "quickBooksRefundReceipt",
    entityId: refund.id,
    actionUrl: "/app/payments",
    metadata: { refundReceiptId: refund.id, amount: Number(refund.totalAmount), candidateHoldIds: candidates.map((item) => item.id) },
    dedupeKey: `refund_receipt:${refund.id}:ambiguous`,
    channels: ["in_app"],
  });
}

async function applyBookingRefundReceipt(agencyId, refund) {
  if (!refund?.customerId || !(refund.totalAmount > 0)) return null;
  const settings = await prisma.agencyQuickBooksSettings.findUnique({
    where: { agencyId },
    select: { consultFeeItemId: true },
  });
  if (!settings?.consultFeeItemId || !refund.itemIds.includes(settings.consultFeeItemId)) return null;

  const refundAt = new Date(refund.createdAt || refund.transactionDate || Date.now());
  const candidates = await prisma.bookingPaymentHold.findMany({
    where: {
      agencyId,
      qbCustomerId: refund.customerId,
      amount: refund.totalAmount,
      status: "Paid",
      createdAt: {
        gte: new Date(refundAt.getTime() - 30 * 86_400_000),
        lte: refundAt,
      },
    },
    orderBy: { createdAt: "desc" },
    take: 3,
  });
  if (candidates.length > 1) {
    // Retrying this indefinitely (the webhook worker's normal failure path)
    // never resolves it — the same two candidates match every time — so it
    // just quietly dies as a FAILED webhook event after 8 attempts with no
    // one ever told. Ambiguity needs a human to look at QuickBooks and
    // decide which booking the refund was actually for; tell staff once
    // (deduped per refund receipt) and still throw so the event bookkeeping
    // behaves the same as before.
    await notifyAmbiguousRefund(agencyId, refund, candidates).catch((notifyError) => {
      logger.warn("booking_payment_hold.ambiguous_refund_notify_failed", { agencyId, refundReceiptId: refund.id, reason: notifyError.message });
    });
    throw new Error(`RefundReceipt ${refund.id} matches multiple paid consultation bookings`);
  }
  const hold = candidates[0];
  if (!hold) return null;

  const updated = await prisma.bookingPaymentHold.updateMany({
    where: { id: hold.id, agencyId, status: "Paid" },
    data: { status: "Refunded" },
  });
  if (updated.count !== 1) return null;

  await recordActivity({
    agencyId,
    userId: null,
    clientId: null,
    caseId: null,
    action: "appointment.payment_refunded",
    details: `Consultation payment of $${Number(refund.totalAmount).toFixed(2)} refunded in QuickBooks for ${hold.guestName}`,
    entityType: "bookingPaymentHold",
    entityId: hold.id,
    metadata: { refundReceiptId: refund.id, appointmentId: hold.appointmentId },
  }).catch(() => {});
  invalidateDashboardCache(agencyId);
  return prisma.bookingPaymentHold.findUnique({ where: { id: hold.id } });
}

async function processCaseInvoiceEvent(event, invoiceId) {
  const row = await prisma.caseInvoice.findFirst({
    where: { agencyId: event.agencyId, qbInvoiceId: invoiceId },
  });
  if (!row) return false;

  if (["Delete", "Void"].includes(event.operation)) {
    await prisma.caseInvoice.update({
      where: { id: row.id },
      data: { status: "Void", balance: 0, lastSyncedAt: new Date() },
    });
    return true;
  }

  const invoice = await getQuickBooksInvoice(event.agencyId, invoiceId);
  if (!invoice) return true;
  await prisma.caseInvoice.update({
    where: { id: row.id },
    data: {
      balance: invoice.balance,
      status: invoice.isVoided
        ? "Void"
        : deriveCaseInvoiceStatus({ balance: invoice.balance, amount: row.amount, dueDate: invoice.dueDate || row.dueDate }),
      qbSyncToken: invoice.syncToken,
      qbInvoiceNumber: invoice.docNumber,
      lastSyncedAt: new Date(),
    },
  });
  return true;
}

async function processEvent(event) {
  if (!event.agencyId) {
    await prisma.quickBooksWebhookEvent.update({ where: { id: event.id }, data: { status: "IGNORED", processedAt: new Date() } });
    return;
  }
  if (event.entityName === "RefundReceipt") {
    if (["Delete", "Void"].includes(event.operation)) {
      await prisma.quickBooksWebhookEvent.update({ where: { id: event.id }, data: { status: "IGNORED", processedAt: new Date() } });
      return;
    }
    const refund = await getQuickBooksRefundReceipt(event.agencyId, event.entityId);
    const hold = await applyBookingRefundReceipt(event.agencyId, refund);
    await prisma.quickBooksWebhookEvent.update({
      where: { id: event.id },
      data: { status: hold ? "PROCESSED" : "IGNORED", processedAt: new Date() },
    });
    return;
  }
  const invoiceIds = await resolveInvoiceIdsForEvent(event);
  let matched = false;
  for (const invoiceId of invoiceIds) {
    if (await processCaseInvoiceEvent(event, invoiceId)) matched = true;
    const hold = await prisma.bookingPaymentHold.findFirst({ where: { agencyId: event.agencyId, qbInvoiceId: invoiceId, status: "AwaitingPayment" } });
    if (!hold) continue;
    matched = true;
    // Never trust the notification's own fields — re-fetch the invoice
    // directly from QuickBooks and decide off its live balance.
    const invoice = await getQuickBooksInvoice(event.agencyId, invoiceId);
    if (!invoice) {
      await prisma.bookingPaymentHold.updateMany({ where: { id: hold.id, status: "AwaitingPayment" }, data: { status: "Voided", voidedAt: new Date() } });
      continue;
    }
    if (invoice.balance <= 0) {
      await confirmPaymentHold(event.agencyId, hold.id);
    }
  }
  await prisma.quickBooksWebhookEvent.update({ where: { id: event.id }, data: { status: matched ? "PROCESSED" : "IGNORED", processedAt: new Date() } });
}

export async function reconcileAgencyBookingRefunds(agencyId, { force = false } = {}) {
  const active = refundReconciliationInFlight.get(agencyId);
  if (active) return active;
  const checkedAt = refundReconciliationChecks.get(agencyId) || 0;
  if (!force && Date.now() - checkedAt < 30_000) return 0;
  refundReconciliationChecks.set(agencyId, Date.now());

  const reconciliation = (async () => {
    const refunds = await listQuickBooksRefundReceiptsSince(agencyId, new Date(Date.now() - 30 * 86_400_000));
    let matched = 0;
    for (const refund of refunds) {
      try {
        if (await applyBookingRefundReceipt(agencyId, refund)) matched += 1;
      } catch (error) {
        logger.warn("booking_payment_hold.refund_reconcile_failed", {
          agencyId,
          refundReceiptId: refund.id,
          reason: error.message,
        });
      }
    }
    return matched;
  })();

  refundReconciliationInFlight.set(agencyId, reconciliation);
  try {
    return await reconciliation;
  } finally {
    refundReconciliationInFlight.delete(agencyId);
  }
}

export async function processQuickBooksWebhookEvents() {
  const events = await prisma.quickBooksWebhookEvent.findMany({
    where: { status: "PENDING", availableAt: { lte: new Date() } },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
  });
  for (const event of events) {
    if (!(await claimEvent(event.id))) continue;
    try {
      await processEvent(event);
    } catch (error) {
      await failEvent(event, error);
    }
  }
  return events.length;
}

// claimEvent moves PENDING -> PROCESSING right before processEvent runs —
// a crash/restart in that window leaves the row stuck PROCESSING forever,
// since processQuickBooksWebhookEvents only ever picks up PENDING rows.
// Recovery reuses the same attempts/maxAttempts bookkeeping as a normal
// failure so a poison-pill event still reaches FAILED eventually instead
// of looping.
const PROCESSING_STUCK_MS = 5 * 60_000;

export async function recoverStuckWebhookEvents() {
  const stuck = await prisma.quickBooksWebhookEvent.findMany({
    where: { status: "PROCESSING", lockedAt: { lte: new Date(Date.now() - PROCESSING_STUCK_MS) } },
    take: 100,
  });
  for (const event of stuck) {
    const attempts = event.attempts + 1;
    const terminal = attempts >= event.maxAttempts;
    await prisma.quickBooksWebhookEvent.updateMany({
      where: { id: event.id, status: "PROCESSING" },
      data: {
        status: terminal ? "FAILED" : "PENDING",
        attempts,
        lockedAt: null,
        lastError: "Recovered from a stuck PROCESSING state (likely a crash/restart mid-processing).",
      },
    });
  }
  return stuck.length;
}

// Refunds issued directly in QuickBooks only reach us via the RefundReceipt
// webhook (unreliable, see above) or whenever staff happen to open the
// Payments page (reconcileAgencyBookingRefunds is called from there). This
// sweep makes refund pickup proactive across every connected agency instead
// of depending on someone looking.
const REFUND_SWEEP_POLL_MS = 5 * 60_000;
let refundSweepTimer = null;

export async function sweepAgencyBookingRefunds() {
  const agencies = await prisma.agencyQuickBooksSettings.findMany({ where: { status: "connected" }, select: { agencyId: true } });
  let total = 0;
  for (const { agencyId } of agencies) {
    total += await reconcileAgencyBookingRefunds(agencyId).catch((error) => {
      logger.warn("quickbooks_webhook.refund_sweep_failed", { agencyId, reason: error.message });
      return 0;
    });
  }
  return total;
}

export function startQuickBooksWebhookWorker() {
  if (!eventTimer) {
    eventTimer = setInterval(() => {
      processQuickBooksWebhookEvents().catch((error) => logger.warn("quickbooks_webhook.pass_failed", { reason: error.message }));
    }, EVENT_POLL_MS);
    if (eventTimer.unref) eventTimer.unref();
  }
  if (!stuckEventTimer) {
    stuckEventTimer = setInterval(() => {
      recoverStuckWebhookEvents().catch((error) => logger.warn("quickbooks_webhook.stuck_recovery_pass_failed", { reason: error.message }));
    }, PROCESSING_STUCK_MS);
    if (stuckEventTimer.unref) stuckEventTimer.unref();
  }
  if (!refundSweepTimer) {
    refundSweepTimer = setInterval(() => {
      sweepAgencyBookingRefunds().catch((error) => logger.warn("quickbooks_webhook.refund_sweep_pass_failed", { reason: error.message }));
    }, REFUND_SWEEP_POLL_MS);
    if (refundSweepTimer.unref) refundSweepTimer.unref();
  }
}

export function stopQuickBooksWebhookWorker() {
  if (eventTimer) clearInterval(eventTimer);
  eventTimer = null;
  if (stuckEventTimer) clearInterval(stuckEventTimer);
  stuckEventTimer = null;
  if (refundSweepTimer) clearInterval(refundSweepTimer);
  refundSweepTimer = null;
}

/**
 * Safety net for a missed or delayed webhook. The public status endpoint
 * calls this while its checkout page is polling, and the expiry worker
 * calls it before expiring or retrying a void. That keeps the webhook as
 * the fast path without making it the only path to a paid appointment.
 */
export async function reconcilePaymentHold(agencyId, holdId, { allowExpired = false, force = false } = {}) {
  const key = `${agencyId}:${holdId}`;
  const active = reconciliationInFlight.get(key);
  if (active) return active;

  const checkedAt = reconciliationChecks.get(key) || 0;
  if (!force && Date.now() - checkedAt < RECONCILE_COOLDOWN_MS) {
    return prisma.bookingPaymentHold.findFirst({ where: { id: holdId, agencyId } });
  }

  if (reconciliationChecks.size >= 1_000) reconciliationChecks.clear();
  reconciliationChecks.set(key, Date.now());

  const reconciliation = (async () => {
    let hold = await prisma.bookingPaymentHold.findFirst({ where: { id: holdId, agencyId } });
    const eligible = hold?.status === "AwaitingPayment"
      || (allowExpired && hold?.status === "Expired" && !hold.voidedAt);
    if (!eligible || !hold.qbInvoiceId) return hold;

    const invoice = await getQuickBooksInvoice(agencyId, hold.qbInvoiceId);
    if (!invoice || invoice.balance > 0) return hold;

    if (hold.status === "Expired") {
      const revived = await prisma.bookingPaymentHold.updateMany({
        where: { id: hold.id, agencyId, status: "Expired", voidedAt: null },
        data: { status: "AwaitingPayment", nextVoidAttemptAt: null },
      });
      if (revived.count !== 1) {
        return prisma.bookingPaymentHold.findFirst({ where: { id: holdId, agencyId } });
      }
      hold = { ...hold, status: "AwaitingPayment" };
    }

    await confirmPaymentHold(agencyId, hold.id);
    const latest = await prisma.bookingPaymentHold.findFirst({ where: { id: holdId, agencyId } });
    if (latest?.status !== "AwaitingPayment" && latest?.status !== "Expired") {
      reconciliationChecks.delete(key);
    }
    return latest;
  })();

  reconciliationInFlight.set(key, reconciliation);
  try {
    return await reconciliation;
  } finally {
    reconciliationInFlight.delete(key);
  }
}

/**
 * Confirms a BookingPaymentHold's payment and creates the real Appointment
 * + Lead. Idempotent via an atomic status claim (mirrors
 * paymentScheduleService.js's claimInstallment) — a redelivered
 * notification, or the webhook and a manual/simulated confirm racing each
 * other, finds no "AwaitingPayment" row left to claim and is a no-op.
 */
export async function confirmPaymentHold(agencyId, holdId) {
  const claimed = await prisma.bookingPaymentHold.updateMany({ where: { id: holdId, status: "AwaitingPayment" }, data: { status: "Confirming" } });
  if (claimed.count !== 1) return null;

  const hold = await prisma.bookingPaymentHold.findUnique({ where: { id: holdId } });
  try {
    // Walk-in (front-desk) holds already have their Appointment — it was
    // created immediately through the normal staff booking flow, with no
    // hold/expiry involved. Confirming one only needs to flip its status;
    // creating a second appointment or lead would be wrong here.
    if (hold.appointmentId) {
      const appointment = await prisma.$transaction(async (tx) => {
        await tx.bookingPaymentHold.update({ where: { id: hold.id }, data: { status: "Paid", paidAt: new Date() } });
        return tx.appointment.findUnique({ where: { id: hold.appointmentId }, include: { assignedTo: { select: { id: true, fullName: true } }, client: { select: { fullName: true, email: true, phone: true } } } });
      });
      await recordActivity({
        agencyId,
        userId: null,
        clientId: appointment.clientId,
        caseId: null,
        action: "invoice.paid",
        details: `Consultation fee paid on the spot for ${hold.guestName}`,
      }).catch(() => {});
      return appointment;
    }

    const [sessionType, settings, offerHold] = await Promise.all([
      hold.sessionTypeId ? prisma.bookingSessionType.findUnique({ where: { id: hold.sessionTypeId } }) : null,
      prisma.bookingSettings.findUnique({ where: { agencyId } }),
      hold.offerHoldId ? prisma.bookingSlotHold.findUnique({ where: { id: hold.offerHoldId } }) : null,
    ]);
    const online = hold.meetingMode === "Online";
    const locations = Array.isArray(settings?.locations) ? settings.locations : [];
    const location = hold.locationId ? locations.find((item) => item.id === hold.locationId) : null;
    const reminderMinutes = Math.max(...(Array.isArray(settings?.reminderSchedule) && settings.reminderSchedule.length ? settings.reminderSchedule : [settings?.reminderMinutes || 1440]));

    const appointment = await prisma.$transaction(async (tx) => {
      // Same exclusion the hold's own creation used — without it, a client
      // fulfilling their own waitlist offer collides with their own
      // still-unclaimed BookingSlotHold right here at confirmation time too.
      const conflict = await assertSlotAvailable(tx, { agencyId, assignedToId: hold.assignedToId, startsAt: hold.startsAt, endsAt: hold.endsAt, excludePaymentHoldId: hold.id, excludeHoldToken: offerHold?.claimToken || null });
      if (conflict) {
        const error = new Error("Slot conflict detected at payment confirmation time");
        error.code = "SLOT_CONFLICT_AT_CONFIRMATION";
        throw error;
      }

      const created = await tx.appointment.create({
        data: {
          agencyId,
          sessionTypeId: hold.sessionTypeId,
          subject: sessionType?.name || "Consultation",
          location: location ? `${location.name} — ${location.address}` : null,
          locationId: hold.locationId,
          locationMapsUrl: location?.mapsUrl || null,
          calendar: "Workspace Calendar",
          startsAt: hold.startsAt,
          endsAt: hold.endsAt,
          description: hold.notes,
          guestName: hold.guestName,
          guestEmail: hold.guestEmail,
          guestEmailNormalized: hold.guestEmailNormalized,
          guestPhone: hold.guestPhone,
          meetingMode: hold.meetingMode,
          meetingUrl: online ? meetingLink() : null,
          assignedToId: hold.assignedToId,
          source: "Public",
          isFreeConsultation: false,
          reminderDueAt: new Date(hold.startsAt.getTime() - reminderMinutes * 60_000),
          referenceCode: appointmentReference(),
          status: "Scheduled",
        },
        include: { assignedTo: { select: { id: true, fullName: true } }, client: { select: { fullName: true, email: true, phone: true } } },
      });
      await recordAppointmentEvent(tx, { agencyId, appointmentId: created.id, type: "BOOKED", summary: "Paid consultation confirmed after payment", metadata: { holdId: hold.id, meetingMode: created.meetingMode } });
      await createOrLinkLeadForPaidConsultation(tx, { agencyId, hold, appointment: created });
      await tx.bookingPaymentHold.update({ where: { id: hold.id }, data: { status: "Paid", paidAt: new Date(), appointmentId: created.id } });
      if (offerHold) {
        // Only now — payment genuinely confirmed and the appointment
        // genuinely created — is the waitlist offer actually fulfilled.
        // Claiming it earlier (at hold-creation) would have marked it
        // "Booked" even for an abandoned checkout that never pays.
        await tx.bookingSlotHold.updateMany({ where: { id: offerHold.id, claimedAt: null }, data: { claimedAt: new Date() } });
        await tx.bookingWaitlistEntry.update({ where: { id: offerHold.waitlistEntryId }, data: { status: "Booked" } });
      }
      return created;
    });

    await recordActivity({
      agencyId,
      userId: null,
      clientId: appointment.clientId,
      caseId: null,
      action: "appointment.booked",
      details: `${sessionType?.name || "Consultation"} confirmed after payment for ${hold.guestName}`,
    }).catch(() => {});
    await sendBookingMessages({ agencyId, appointment, kind: "booked" }).catch((error) => {
      logger.warn("booking_payment_hold.confirmation_message_failed", { agencyId, holdId, reason: error.message });
    });
    invalidateDashboardCache(agencyId);
    return appointment;
  } catch (error) {
    // A genuine slot conflict at confirmation time (the hold expired and
    // was released, another client took the slot, and *then* this payment
    // landed) is unrecoverable by retrying — reverting to "AwaitingPayment"
    // here used to send it straight back into the same conflict on every
    // future reconcile pass forever (the expiry sweep's pre-expiry
    // reconcile always "continue"s on error, so it never re-expires or
    // voids either — a silent infinite loop). The money is real and
    // collected either way, so record that honestly as "Paid" with no
    // appointment attached, and get a human involved immediately instead
    // of hiding it.
    if (error.code === "SLOT_CONFLICT_AT_CONFIRMATION") {
      const orphaned = await prisma.bookingPaymentHold.update({ where: { id: hold.id }, data: { status: "Paid", paidAt: new Date() } });
      logger.warn("booking_payment_hold.confirmed_with_no_slot", { agencyId, holdId });
      await notifyOrphanedPayment(orphaned).catch((notifyError) => {
        logger.warn("booking_payment_hold.orphaned_notify_failed", { agencyId, holdId, reason: notifyError.message });
      });
      invalidateDashboardCache(agencyId);
      return null;
    }
    // The invoice IS paid at this point — release the claim so a future
    // webhook redelivery or the safety-net poll can retry rather than
    // silently dropping a paid booking.
    await prisma.bookingPaymentHold.update({ where: { id: hold.id }, data: { status: "AwaitingPayment" } }).catch(() => {});
    logger.warn("booking_payment_hold.confirm_failed", { agencyId, holdId, reason: error.message });
    throw error;
  }
}
