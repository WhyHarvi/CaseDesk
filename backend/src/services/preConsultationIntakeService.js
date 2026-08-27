import prisma from "./prisma/client.js";
import { createMailTransport, resolveAgencyMailConfig } from "./agencyMailService.js";
import { sendSmsMessage } from "./communicationProviderService.js";
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
  SUMMARY_GENERATED: "PRE_CONSULTATION_INTAKE_SUMMARY_GENERATED",
});

const DELIVERY_TYPES = [PRE_CONSULTATION_EVENT.DELIVERY_QUEUED, PRE_CONSULTATION_EVENT.DELIVERY_SENT, PRE_CONSULTATION_EVENT.DELIVERY_PARTIAL, PRE_CONSULTATION_EVENT.DELIVERY_FAILED];
const WORKER_INTERVAL_MS = Math.max(Number(process.env.PRE_CONSULTATION_INTAKE_POLL_MS) || 30_000, 10_000);
const FEATURE_RELEASE_AT = new Date(process.env.PRE_CONSULTATION_INTAKE_START_AT || "2026-08-20T18:26:00.000Z");
let workerTimer = null;
let workerRunning = false;

export const preConsultationAppointmentInclude = {
  client: { select: { id: true, fullName: true, email: true, phone: true } },
  lead: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
  agency: {
    select: {
      id: true, name: true, legalName: true, email: true, phone: true, logoUrl: true,
      bookingSettings: { select: { timezone: true, preConsultationIntakeEnabled: true, preConsultationEmailEnabled: true, preConsultationSmsEnabled: true } },
    },
  },
  sessionType: { select: { id: true, name: true } },
};

const clean = (value, max = 500) => String(value || "").trim().slice(0, max);
const metadata = (event) => event?.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata) ? event.metadata : {};
const errorText = (error) => clean(error?.message || "Delivery failed", 1000);

function recipient(appointment) {
  const leadName = [appointment.lead?.firstName, appointment.lead?.lastName].filter(Boolean).join(" ").trim();
  return {
    name: clean(appointment.guestName || appointment.client?.fullName || leadName || "there", 160),
    email: clean(appointment.guestEmail || appointment.client?.email || appointment.lead?.email, 320).toLowerCase(),
    phone: clean(appointment.guestPhone || appointment.client?.phone || appointment.lead?.phone, 60),
  };
}

function workspaceName(appointment) {
  return clean(appointment.agency?.legalName || appointment.agency?.name || "Your immigration team", 180);
}

function appointmentTime(appointment) {
  return new Date(appointment.startsAt).toLocaleString("en-CA", {
    timeZone: appointment.agency?.bookingSettings?.timezone || "America/Toronto",
    weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function escapeHtml(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

export function preConsultationIntakeUrl(manageToken, environment = process.env) {
  if (!manageToken) return null;
  const url = new URL(`/public/intake/${encodeURIComponent(manageToken)}`, bookingPublicOrigin(environment));
  url.searchParams.set("type", "consultation");
  return url.toString();
}

async function reserve(appointment, { force = false, actorUserId = null } = {}) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pre-consultation-intake:${appointment.id}`}))`;
    if (force) {
      return {
        event: await recordAppointmentEvent(tx, {
          agencyId: appointment.agencyId,
          appointmentId: appointment.id,
          actorUserId,
          type: PRE_CONSULTATION_EVENT.DELIVERY_QUEUED,
          summary: "Pre-consultation questionnaire queued manually",
          metadata: { questionnaireVersion: 1, emailStatus: "pending", smsStatus: "pending", attempts: 0, source: "staff_manual" },
        }),
        skip: false,
      };
    }
    const existing = await tx.appointmentEvent.findFirst({ where: { appointmentId: appointment.id, type: { in: DELIVERY_TYPES } }, orderBy: { createdAt: "desc" } });
    if (existing?.type === PRE_CONSULTATION_EVENT.DELIVERY_SENT) return { event: existing, skip: true };
    const details = metadata(existing);
    if (details.nextAttemptAt && new Date(details.nextAttemptAt).getTime() > Date.now()) return { event: existing, skip: true };
    if (existing) return { event: existing, skip: false };
    return {
      event: await recordAppointmentEvent(tx, {
        agencyId: appointment.agencyId,
        appointmentId: appointment.id,
        type: PRE_CONSULTATION_EVENT.DELIVERY_QUEUED,
        summary: "Pre-consultation questionnaire queued",
        metadata: { questionnaireVersion: 1, emailStatus: "pending", smsStatus: "pending", attempts: 0 },
      }),
      skip: false,
    };
  });
}

async function emailQuestionnaire(appointment, contact, intakeUrl) {
  if (!contact.email) return { status: "skipped", reason: "No email address" };
  const config = await resolveAgencyMailConfig(appointment.agencyId);
  const transport = createMailTransport(config);
  const agency = workspaceName(appointment);
  const when = appointmentTime(appointment);
  const subject = "Complete your pre-consultation information";
  const text = `Hi ${contact.name},\n\nYour consultation with ${agency} is booked for ${when}.\n\nPlease complete this short immigration questionnaire before your appointment so your consultant can review your background and use the consultation time effectively.\n\n${intakeUrl}\n\nPlease provide information that is accurate to the best of your knowledge. You do not need to upload immigration documents through this form.`;
  const html = `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a"><table role="presentation" width="100%"><tr><td align="center" style="padding:32px 14px"><table role="presentation" width="100%" style="max-width:600px;background:#fff;border:1px solid #e2e8f0;border-radius:24px"><tr><td style="padding:28px 30px;background:#0f172a;border-radius:24px 24px 0 0;color:#fff"><strong>${escapeHtml(agency)}</strong><div style="margin-top:5px;color:#94a3b8;font-size:12px">Pre-consultation questionnaire</div></td></tr><tr><td style="padding:32px 30px"><h1 style="margin:0;font-size:28px">Help us prepare for your consultation</h1><p style="color:#475569;line-height:1.7">Hi ${escapeHtml(contact.name)}, your consultation is booked for <strong>${escapeHtml(when)}</strong>.</p><p style="color:#475569;line-height:1.7">Please complete this short immigration questionnaire before your appointment. It helps your consultant understand your status, study and work history, previous applications, and important deadlines.</p><p style="margin:24px 0"><a href="${escapeHtml(intakeUrl)}" style="display:inline-block;border-radius:999px;background:#0f172a;color:#fff;text-decoration:none;padding:14px 22px;font-weight:700">Complete questionnaire →</a></p><p style="color:#64748b;font-size:12px;line-height:1.6">Do not upload passports, permits, or other immigration documents through this form. Detailed documents can be collected later through the secure client portal.</p></td></tr></table></td></tr></table></body></html>`;
  try {
    const result = await transport.sendMail({ from: config.from, to: contact.email, subject, text, html });
    return { status: "sent", providerId: result?.messageId || null };
  } finally { transport.close?.(); }
}

async function smsQuestionnaire(appointment, contact, intakeUrl, deliveryKey) {
  if (!contact.phone) return { status: "skipped", reason: "No phone number" };
  const result = await sendSmsMessage({
    agencyId: appointment.agencyId,
    to: contact.phone,
    body: `${workspaceName(appointment)}: Please complete your pre-consultation immigration questionnaire before your appointment: ${intakeUrl}`,
    idempotencyKey: `pre-consultation-intake:${appointment.id}:${deliveryKey}`,
  });
  return { status: "sent", providerId: result?.id || null, provider: result?.provider || null };
}

const retryDelay = (attempt) => Math.min(60 * 60_000, 60_000 * 2 ** Math.max(0, attempt - 1));

export function automaticPreConsultationIntakeEnabled(appointment) {
  const settings = appointment?.agency?.bookingSettings;
  return settings?.preConsultationEmailEnabled === true || settings?.preConsultationSmsEnabled === true;
}

export async function deliverPreConsultationIntake(appointment, { force = false, actorUserId = null } = {}) {
  if (!appointment?.id || appointment.status !== "Scheduled" || !appointment.manageToken) return null;
  // Manual staff sends deliberately bypass the workspace automation switch.
  // Automatic sends reload the switches here so a change made after the
  // worker selected an appointment is still respected before delivery.
  const bookingSettings = force
    ? appointment.agency?.bookingSettings
    : await prisma.bookingSettings.findUnique({
      where: { agencyId: appointment.agencyId },
      select: { preConsultationEmailEnabled: true, preConsultationSmsEnabled: true },
    });
  if (!force && !automaticPreConsultationIntakeEnabled({ agency: { bookingSettings } })) return null;
  const reservation = await reserve(appointment, { force, actorUserId });
  if (!reservation?.event || reservation.skip) return reservation?.event || null;

  const existing = metadata(reservation.event);
  const contact = recipient(appointment);
  const intakeUrl = preConsultationIntakeUrl(appointment.manageToken);
  const attempt = Number(existing.attempts || 0) + 1;
  const automaticEmailEnabled = force || bookingSettings?.preConsultationEmailEnabled === true;
  const automaticSmsEnabled = force || bookingSettings?.preConsultationSmsEnabled === true;
  let email = !automaticEmailEnabled ? { status: "skipped", reason: "Automatic email is turned off" } : existing.emailStatus === "sent" ? { status: "sent", providerId: existing.emailProviderId || null } : existing.emailStatus === "skipped" ? { status: "skipped", reason: existing.emailError } : null;
  let sms = !automaticSmsEnabled ? { status: "skipped", reason: "Automatic SMS is turned off" } : existing.smsStatus === "sent" ? { status: "sent", providerId: existing.smsProviderId || null } : existing.smsStatus === "skipped" ? { status: "skipped", reason: existing.smsError } : null;
  if (!email) { try { email = await emailQuestionnaire(appointment, contact, intakeUrl); } catch (error) { email = { status: "failed", reason: errorText(error) }; } }
  if (!sms) { try { sms = await smsQuestionnaire(appointment, contact, intakeUrl, reservation.event.id); } catch (error) { sms = { status: "failed", reason: errorText(error) }; } }

  const sent = [email, sms].filter((item) => item?.status === "sent").length;
  const failed = [email, sms].filter((item) => item?.status === "failed").length;
  const skipped = [email, sms].filter((item) => item?.status === "skipped").length;
  const complete = failed === 0 && sent > 0;
  const type = complete ? PRE_CONSULTATION_EVENT.DELIVERY_SENT : sent ? PRE_CONSULTATION_EVENT.DELIVERY_PARTIAL : PRE_CONSULTATION_EVENT.DELIVERY_FAILED;
  const nextAttemptAt = failed ? new Date(Date.now() + retryDelay(attempt)).toISOString() : null;
  const source = force ? "staff_manual" : existing.source || "automatic";
  const updated = await prisma.appointmentEvent.update({
    where: { id: reservation.event.id },
    data: {
      type,
      summary: complete
        ? (force ? "Pre-consultation questionnaire sent manually" : "Pre-consultation questionnaire sent automatically")
        : sent
          ? (force ? "Pre-consultation questionnaire manually sent with partial delivery" : "Pre-consultation questionnaire partially delivered")
          : "Pre-consultation questionnaire delivery failed",
      metadata: {
        questionnaireVersion: 1, intakeUrl, attempts: attempt, lastAttemptAt: new Date().toISOString(), nextAttemptAt, source,
        emailStatus: email?.status || "failed", emailProviderId: email?.providerId || null, emailError: email?.reason || null,
        smsStatus: sms?.status || "failed", smsProviderId: sms?.providerId || null, smsProvider: sms?.provider || null, smsError: sms?.reason || null,
      },
    },
  });
  if (!complete) logger.warn("pre_consultation_intake.delivery_incomplete", { appointmentId: appointment.id, agencyId: appointment.agencyId, emailStatus: email?.status, smsStatus: sms?.status, skipped, nextAttemptAt });
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
        agency: { bookingSettings: { OR: [{ preConsultationEmailEnabled: true }, { preConsultationSmsEnabled: true }] } },
        events: { none: { type: { in: [PRE_CONSULTATION_EVENT.DELIVERY_SENT, PRE_CONSULTATION_EVENT.SUBMITTED] } } },
      },
      include: preConsultationAppointmentInclude,
      orderBy: { createdAt: "asc" },
      take: 25,
    });
    for (const appointment of appointments) {
      try { await deliverPreConsultationIntake(appointment); }
      catch (error) { logger.error("pre_consultation_intake.worker_delivery_failed", { appointmentId: appointment.id, agencyId: appointment.agencyId, error: errorText(error) }); }
    }
  } catch (error) { logger.error("pre_consultation_intake.worker_failed", { error: errorText(error) }); }
  finally { workerRunning = false; }
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
  const appointment = await prisma.appointment.findUnique({ where: { manageToken: clean(manageToken, 200) }, include: preConsultationAppointmentInclude });
  if (!appointment) return null;
  return { ...appointment, bookingSettings: appointment.agency?.bookingSettings || null };
}

export function preConsultationStatus(events = []) {
  if (events.some((event) => event.type === PRE_CONSULTATION_EVENT.SUBMITTED)) return "Submitted";
  if (events.some((event) => event.type === PRE_CONSULTATION_EVENT.OPENED)) return "Opened";
  if (events.some((event) => event.type === PRE_CONSULTATION_EVENT.DELIVERY_SENT)) return "Sent";
  if (events.some((event) => event.type === PRE_CONSULTATION_EVENT.DELIVERY_PARTIAL)) return "PartiallySent";
  if (events.some((event) => event.type === PRE_CONSULTATION_EVENT.DELIVERY_FAILED)) return "DeliveryFailed";
  return "NotSent";
}
