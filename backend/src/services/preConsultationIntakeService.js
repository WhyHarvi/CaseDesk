import prisma from "./prisma/client.js";
import { createMailTransport, resolveAgencyMailConfig } from "./agencyMailService.js";
import { sendAgencyOomaSms } from "./agencyOomaService.js";
import { bookingPublicOrigin } from "./bookingPublicLinkService.js";
import { logger } from "./logger.js";
import { recordAppointmentEvent } from "./appointmentOperationsService.js";

export const PRE_CONSULTATION_EVENT = Object.freeze({
  DELIVERY_QUEUED: "PRE_CONSULTATION_INTAKE_QUEUED",
  DELIVERY_SENT: "PRE_CONSULTATION_INTAKE_SENT",
  DELIVERY_PARTIAL: "PRE_CONSULTATION_INTAKE_DELIVERY_PARTIAL",
  DELIVERY_FAILED: "PRE_CONSULTATION_INTAKE_DELIVERY_FAILED",
  OPENED: "PRE_CONSULTATION_INTAKE_OPENED",
  SUBMITTED: "PRE_CONSULTATION_INTAKE_SUBMITTED",
});

const DELIVERY_TYPES = [
  PRE_CONSULTATION_EVENT.DELIVERY_QUEUED,
  PRE_CONSULTATION_EVENT.DELIVERY_SENT,
  PRE_CONSULTATION_EVENT.DELIVERY_PARTIAL,
  PRE_CONSULTATION_EVENT.DELIVERY_FAILED,
];

const WORKER_INTERVAL_MS = Math.max(Number(process.env.PRE_CONSULTATION_INTAKE_POLL_MS) || 30_000, 10_000);
// Do not back-send the new questionnaire to appointments that existed before
// this feature was enabled. The value can be overridden per deployment.
const FEATURE_RELEASE_AT = new Date(
  process.env.PRE_CONSULTATION_INTAKE_START_AT || "2026-08-20T18:26:00.000Z",
);

let workerTimer = null;
let workerRunning = false;

function cleanString(value, max = 500) {
  return String(value || "").trim().slice(0, max);
}

function eventMetadata(event) {
  return event?.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata)
    ? event.metadata
    : {};
}

function recipientContact(appointment) {
  const leadName = [appointment?.lead?.firstName, appointment?.lead?.lastName].filter(Boolean).join(" ").trim();
  return {
    name: cleanString(appointment?.guestName || appointment?.client?.fullName || leadName || "there", 160),
    email: cleanString(appointment?.guestEmail || appointment?.client?.email || appointment?.lead?.email, 320).toLowerCase(),
    phone: cleanString(appointment?.guestPhone || appointment?.client?.phone || appointment?.lead?.phone, 60),
  };
}

function agencyName(appointment) {
  return cleanString(appointment?.agency?.legalName || appointment?.agency?.name || "Your immigration team", 180);
}

function formatAppointment(appointment) {
  const timezone = appointment?.bookingSettings?.timezone || "America/Toronto";
  const startsAt = new Date(appointment.startsAt);
  return startsAt.toLocaleString("en-CA", {
    timeZone: timezone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function preConsultationIntakeUrl(manageToken, environment = process.env) {
  if (!manageToken) return null;
  const url = new URL(`/public/intake/${encodeURIComponent(manageToken)}`, bookingPublicOrigin(environment));
  url.searchParams.set("type", "consultation");
  return url.toString();
}

export const preConsultationAppointmentInclude = Object.freeze({
  client: { select: { id: true, fullName: true, email: true, phone: true } },
  lead: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
  agency: { select: { id: true, name: true, legalName: true, email: true, phone: true, logoUrl: true } },
  sessionType: { select: { id: true, name: true } },
  bookingSettings: { select: { timezone: true } },
});

async function reserveDeliveryEvent(appointment) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`pre-consultation-intake:${appointment.id}`}))`;
    const existing = await tx.appointmentEvent.findFirst({
      where: { appointmentId: appointment.id, type: { in: DELIVERY_TYPES } },
      orderBy: { createdAt: "desc" },
    });
    if (existing?.type === PRE_CONSULTATION_EVENT.DELIVERY_SENT) return { event: existing, skip: true };
    const metadata = eventMetadata(existing);
    if (metadata.nextAttemptAt && new Date(metadata.nextAttemptAt).getTime() > Date.now()) {
      return { event: existing, skip: true };
    }
    if (existing) return { event: existing, skip: false };
    const created = await recordAppointmentEvent(tx, {
      agencyId: appointment.agencyId,
      appointmentId: appointment.id,
      type: PRE_CONSULTATION_EVENT.DELIVERY_QUEUED,
      summary: "Pre-consultation questionnaire queued",
      metadata: {
        questionnaireVersion: 1,
        emailStatus: "pending",
        smsStatus: "pending",
        attempts: 0,
      },
    });
    return { event: created, skip: false };
  });
}

async function sendEmail(appointment, contact, intakeUrl) {
  if (!contact.email) return { status: "skipped", reason: "No email address" };
  const config = await resolveAgencyMailConfig(appointment.agencyId);
  const transport = createMailTransport(config);
  const name = agencyName(appointment);
  const appointmentTime = formatAppointment(appointment);
  const subject = "Complete your pre-consultation information";
  const text = [
    `Hi ${contact.name},`,
    "",
    `Your consultation with ${name} is booked for ${appointmentTime}.`,
    "Please complete this short immigration questionnaire before your appointment so your consultant can review your background and use the consultation time effectively.",
    "",
    intakeUrl,
    "",
    "Please provide information that is accurate to the best of your knowledge. You do not need to upload immigration documents through this form.",
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 14px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border:1px solid #e2e8f0;border-radius:24px"><tr><td style="padding:28px 30px;background:#0f172a;border-radius:24px 24px 0 0;color:#fff"><div style="font-size:18px;font-weight:750">${escapeHtml(name)}</div><div style="margin-top:5px;color:#94a3b8;font-size:12px">Pre-consultation questionnaire</div></td></tr><tr><td style="padding:32px 30px"><p style="margin:0;color:#64748b;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em">Appointment booked</p><h1 style="margin:10px 0 0;font-size:28px;line-height:1.2">Help us prepare for your consultation</h1><p style="margin:18px 0 0;color:#475569;font-size:15px;line-height:1.7">Hi ${escapeHtml(contact.name)}, your consultation is booked for <strong>${escapeHtml(appointmentTime)}</strong>.</p><p style="margin:14px 0 0;color:#475569;font-size:15px;line-height:1.7">Please complete this short immigration questionnaire before your appointment. It helps your consultant understand your status, study and work history, permits, previous applications, and any urgent deadlines.</p><p style="margin:24px 0"><a href="${escapeHtml(intakeUrl)}" style="display:inline-block;border-radius:999px;background:#0f172a;color:#fff;text-decoration:none;padding:14px 22px;font-size:14px;font-weight:700">Complete questionnaire →</a></p><p style="margin:0;color:#64748b;font-size:12px;line-height:1.6">Please do not upload passports, permits, or other immigration documents through this form. Detailed documents can be collected later through the secure client portal.</p></td></tr></table></td></tr></table></body></html>`;
  try {
    const result = await transport.sendMail({ from: config.from, to: contact.email, subject, text, html });
    return { status: "sent", providerId: result?.messageId || null };
  } finally {
    transport.close?.();
  }
}

async function sendSms(appointment, contact, intakeUrl) {
  if (!contact.phone) return { status: "skipped", reason: "No phone number" };
  const name = agencyName(appointment);
  const result = await sendAgencyOomaSms({
    agencyId: appointment.agencyId,
    to: contact.phone,
    body: `${name}: Please complete your pre-consultation immigration questionnaire before your appointment: ${intakeUrl}`,
    idempotencyKey: `pre-consultation-intake:${appointment.id}`,
  });
  return { status: "sent", providerId: result?.id || null, provider: result?.provider || null };
}

function retryDelayMs(attempt) {
  return Math.min(60 * 60_000, Math.max(60_000, 60_000 * 2 ** Math.max(0, attempt - 1)));
}

function failureMessage(error) {
  return cleanString(error?.message || "Delivery failed", 1000);
}

export async function deliverPreConsultationIntake(appointment) {
  if (!appointment?.id || appointment.status !== "Scheduled" || !appointment.manageToken) return null;
  const reservation = await reserveDeliveryEvent(appointment);
  if (!reservation?.event || reservation.skip) return reservation?.event || null;

  const existing = eventMetadata(reservation.event);
  const contact = recipientContact(appointment);
  const intakeUrl = preConsultationIntakeUrl(appointment.manageToken);
  const attempt = Number(existing.attempts || 0) + 1;
  let email = existing.emailStatus === "sent"
    ? { status: "sent", providerId: existing.emailProviderId || null }
    : existing.emailStatus === "skipped"
      ? { status: "skipped", reason: existing.emailError || "No email address" }
      : null;
  let sms = existing.smsStatus === "sent"
    ? { status: "sent", providerId: existing.smsProviderId || null }
    : existing.smsStatus === "skipped"
      ? { status: "skipped", reason: existing.smsError || "No phone number" }
      : null;

  if (!email) {
    try { email = await sendEmail(appointment, contact, intakeUrl); }
    catch (error) { email = { status: "failed", reason: failureMessage(error) }; }
  }
  if (!sms) {
    try { sms = await sendSms(appointment, contact, intakeUrl); }
    catch (error) { sms = { status: "failed", reason: failureMessage(error) }; }
  }

  const sentCount = [email, sms].filter((item) => item?.status === "sent").length;
  const failedCount = [email, sms].filter((item) => item?.status === "failed").length;
  const complete = failedCount === 0 && sentCount > 0;
  const type = complete
    ? PRE_CONSULTATION_EVENT.DELIVERY_SENT
    : sentCount > 0
      ? PRE_CONSULTATION_EVENT.DELIVERY_PARTIAL
      : PRE_CONSULTATION_EVENT.DELIVERY_FAILED;
  const nextAttemptAt = failedCount > 0 ? new Date(Date.now() + retryDelayMs(attempt)).toISOString() : null;

  const updated = await prisma.appointmentEvent.update({
    where: { id: reservation.event.id },
    data: {
      type,
      summary: complete
        ? "Pre-consultation questionnaire sent automatically"
        : sentCount > 0
          ? "Pre-consultation questionnaire partially delivered"
          : "Pre-consultation questionnaire delivery failed",
      metadata: {
        questionnaireVersion: 1,
        intakeUrl,
        attempts: attempt,
        lastAttemptAt: new Date().toISOString(),
        nextAttemptAt,
        emailStatus: email?.status || "failed",
        emailProviderId: email?.providerId || null,
        emailError: email?.reason || null,
        smsStatus: sms?.status || "failed",
        smsProviderId: sms?.providerId || null,
        smsProvider: sms?.provider || null,
        smsError: sms?.reason || null,
      },
    },
  });

  if (!complete) {
    logger.warn("pre_consultation_intake.delivery_incomplete", {
      appointmentId: appointment.id,
      agencyId: appointment.agencyId,
      emailStatus: email?.status,
      smsStatus: sms?.status,
      nextAttemptAt,
    });
  }
  return updated;
}

export async function processPreConsultationIntakeDeliveries() {
  if (workerRunning) return;
  workerRunning = true;
  try {
    const appointments = await prisma.appointment.findMany({
      where: {
        status: "Scheduled",
        startsAt: { gt: new Date() },
        createdAt: { gte: FEATURE_RELEASE_AT },
        manageToken: { not: null },
        events: { none: { type: { in: [PRE_CONSULTATION_EVENT.DELIVERY_SENT, PRE_CONSULTATION_EVENT.SUBMITTED] } } },
      },
      include: preConsultationAppointmentInclude,
      orderBy: { createdAt: "asc" },
      take: 25,
    });
    for (const appointment of appointments) {
      try { await deliverPreConsultationIntake(appointment); }
      catch (error) {
        logger.error("pre_consultation_intake.worker_delivery_failed", {
          appointmentId: appointment.id,
          agencyId: appointment.agencyId,
          error: failureMessage(error),
        });
      }
    }
  } catch (error) {
    logger.error("pre_consultation_intake.worker_failed", { error: failureMessage(error) });
  } finally {
    workerRunning = false;
  }
}

export function startPreConsultationIntakeWorker() {
  if (workerTimer || process.env.NODE_ENV === "test") return;
  const initial = setTimeout(() => void processPreConsultationIntakeDeliveries(), 3_000);
  initial.unref?.();
  workerTimer = setInterval(() => void processPreConsultationIntakeDeliveries(), WORKER_INTERVAL_MS);
  workerTimer.unref?.();
}

export function stopPreConsultationIntakeWorker() {
  if (workerTimer) clearInterval(workerTimer);
  workerTimer = null;
}

export async function getManagedPreConsultationAppointment(manageToken) {
  const appointment = await prisma.appointment.findUnique({
    where: { manageToken: cleanString(manageToken, 200) },
    include: preConsultationAppointmentInclude,
  });
  return appointment;
}

export function preConsultationStatus(events = []) {
  if (events.some((event) => event.type === PRE_CONSULTATION_EVENT.SUBMITTED)) return "Submitted";
  if (events.some((event) => event.type === PRE_CONSULTATION_EVENT.OPENED)) return "Opened";
  if (events.some((event) => event.type === PRE_CONSULTATION_EVENT.DELIVERY_SENT)) return "Sent";
  if (events.some((event) => event.type === PRE_CONSULTATION_EVENT.DELIVERY_PARTIAL)) return "PartiallySent";
  if (events.some((event) => event.type === PRE_CONSULTATION_EVENT.DELIVERY_FAILED)) return "DeliveryFailed";
  return "NotSent";
}
