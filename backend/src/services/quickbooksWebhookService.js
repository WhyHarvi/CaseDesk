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

export function startQuickBooksWebhookWorker() {
  if (eventTimer) return;
  eventTimer = setInterval(() => {
    processQuickBooksWebhookEvents().catch((error) => logger.warn("quickbooks_webhook.pass_failed", { reason: error.message }));
  }, EVENT_POLL_MS);
  if (eventTimer.unref) eventTimer.unref();
}

export function stopQuickBooksWebhookWorker() {
  if (eventTimer) clearInterval(eventTimer);
  eventTimer = null;
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

    const [sessionType, settings] = await Promise.all([
      hold.sessionTypeId ? prisma.bookingSessionType.findUnique({ where: { id: hold.sessionTypeId } }) : null,
      prisma.bookingSettings.findUnique({ where: { agencyId } }),
    ]);
    const online = hold.meetingMode === "Online";
    const locations = Array.isArray(settings?.locations) ? settings.locations : [];
    const location = hold.locationId ? locations.find((item) => item.id === hold.locationId) : null;
    const reminderMinutes = Math.max(...(Array.isArray(settings?.reminderSchedule) && settings.reminderSchedule.length ? settings.reminderSchedule : [settings?.reminderMinutes || 1440]));

    const appointment = await prisma.$transaction(async (tx) => {
      const conflict = await assertSlotAvailable(tx, { agencyId, assignedToId: hold.assignedToId, startsAt: hold.startsAt, endsAt: hold.endsAt, excludePaymentHoldId: hold.id });
      if (conflict) throw new Error("Slot conflict detected at payment confirmation time");

      const created = await tx.appointment.create({
        data: {
          agencyId,
          sessionTypeId: hold.sessionTypeId,
          subject: sessionType?.name || "Consultation",
          location: location ? `${location.name} — ${location.address}` : null,
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
    // The invoice IS paid at this point — release the claim so a future
    // webhook redelivery or the safety-net poll can retry rather than
    // silently dropping a paid booking.
    await prisma.bookingPaymentHold.update({ where: { id: hold.id }, data: { status: "AwaitingPayment" } }).catch(() => {});
    logger.warn("booking_payment_hold.confirm_failed", { agencyId, holdId, reason: error.message });
    throw error;
  }
}
