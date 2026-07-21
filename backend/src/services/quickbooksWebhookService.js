import { randomUUID } from "node:crypto";
import prisma from "./prisma/client.js";
import { logger } from "./logger.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { getQuickBooksInvoice, getQuickBooksPayment } from "./quickbooksService.js";
import { assertSlotAvailable } from "./bookingAvailabilityService.js";
import { sendBookingMessages } from "./bookingNotificationService.js";
import { appointmentReference, recordAppointmentEvent } from "./appointmentOperationsService.js";
import { invalidateDashboardCache } from "./dashboardCache.js";
import { createOrLinkLeadForPaidConsultation } from "../modules/leads/lead.booking.js";

const EVENT_POLL_MS = 5_000;
const BATCH_SIZE = 20;
let eventTimer = null;

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
      rawPayload: entity,
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

async function processEvent(event) {
  if (!event.agencyId) {
    await prisma.quickBooksWebhookEvent.update({ where: { id: event.id }, data: { status: "IGNORED", processedAt: new Date() } });
    return;
  }
  const invoiceIds = await resolveInvoiceIdsForEvent(event);
  let matched = false;
  for (const invoiceId of invoiceIds) {
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
