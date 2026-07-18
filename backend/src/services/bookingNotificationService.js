import prisma from "./prisma/client.js";
import { logger } from "./logger.js";
import { createMailTransport, resolveAgencyMailConfig } from "./agencyMailService.js";
import { sendAgencyOomaSms } from "./agencyOomaService.js";
import { adminRecipientIds, notifyUsers } from "./notificationService.js";

const REMINDER_POLL_MS = 5 * 60_000;
let reminderTimer = null;

function frontendBase() {
  return String(process.env.FRONTEND_URL || "http://localhost:5173").split(",")[0].trim().replace(/\/$/, "");
}

function icsDate(value) {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function icsForAppointment(appointment, agencyName) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CaseDesk//Booking//EN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${appointment.id}@casedesk`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(appointment.startsAt)}`,
    `DTEND:${icsDate(appointment.endsAt)}`,
    `SUMMARY:${String(appointment.subject || "Appointment").replace(/[\n,;]/g, " ")} — ${String(agencyName || "CaseDesk").replace(/[\n,;]/g, " ")}`,
    appointment.meetingUrl
      ? `LOCATION:${appointment.meetingUrl}`
      : appointment.location
        ? `LOCATION:${String(appointment.location).replace(/[\n,;]/g, " ")}`
        : null,
    appointment.meetingUrl ? `DESCRIPTION:Join online: ${appointment.meetingUrl}` : null,
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  return lines.join("\r\n");
}

function recipientContact(appointment) {
  return {
    email: appointment.guestEmail || appointment.client?.email || null,
    phone: appointment.guestPhone || appointment.client?.phone || null,
    name: appointment.guestName || appointment.client?.fullName || "there",
  };
}

function formatWhen(appointment, timezone) {
  const options = { timeZone: timezone, weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" };
  return new Date(appointment.startsAt).toLocaleString("en-CA", options);
}

const KIND_COPY = {
  booked: { title: "Appointment confirmed", intro: "Your appointment is booked." },
  rescheduled: { title: "Appointment rescheduled", intro: "Your appointment has been moved." },
  cancelled: { title: "Appointment cancelled", intro: "Your appointment has been cancelled." },
  reminder: { title: "Appointment reminder", intro: "This is a reminder about your upcoming appointment." },
};

/**
 * Sends client-facing email + SMS and staff in-app notifications for a
 * booking event. Every channel is best-effort: a missing mailbox or Ooma
 * connection never fails the booking itself.
 */
export async function sendBookingMessages({ agencyId, appointment, kind, actorUserId = null }) {
  const [agency, settings] = await Promise.all([
    prisma.agency.findUnique({ where: { id: agencyId }, select: { name: true, legalName: true } }),
    prisma.bookingSettings.findUnique({ where: { agencyId } }),
  ]);
  const timezone = settings?.timezone || "America/Toronto";
  const agencyName = agency?.legalName || agency?.name || "CaseDesk";
  const contact = recipientContact(appointment);
  const copy = KIND_COPY[kind] || KIND_COPY.booked;
  const when = formatWhen(appointment, timezone);
  const manageUrl = appointment.manageToken ? `${frontendBase()}/book/manage/${appointment.manageToken}` : null;

  if (contact.email) {
    try {
      const config = await resolveAgencyMailConfig(agencyId);
      const transport = createMailTransport(config);
      const mapsHref = appointment.location
        ? appointment.locationMapsUrl || `https://maps.google.com/?q=${encodeURIComponent(appointment.location.split(" — ").pop())}`
        : null;
      const meetingLine = appointment.meetingUrl
        ? `<p><strong>Join online:</strong> <a href="${appointment.meetingUrl}">${appointment.meetingUrl}</a></p>`
        : appointment.location
          ? `<p><strong>Location:</strong> ${appointment.location} · <a href="${mapsHref}">Open in Maps</a></p>`
          : "";
      const manageLine = kind !== "cancelled" && manageUrl
        ? `<p style="margin-top:16px">Need to make a change? <a href="${manageUrl}">Reschedule or cancel</a>.</p>`
        : "";
      await transport.sendMail({
        from: config.from,
        to: contact.email,
        subject: `${copy.title} — ${appointment.subject} on ${when}`,
        html: `
          <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">
            <h2 style="font-weight:600">${copy.title}</h2>
            <p>Hi ${contact.name},</p>
            <p>${copy.intro}</p>
            <div style="border:1px solid #e2e8f0;border-radius:14px;padding:16px;margin:14px 0">
              <p style="margin:0 0 6px"><strong>${appointment.subject}</strong></p>
              <p style="margin:0 0 6px">${when} (${timezone})</p>
              ${meetingLine}
            </div>
            ${manageLine}
            <p style="color:#64748b;font-size:13px;margin-top:20px">${agencyName}</p>
          </div>`,
        attachments: kind === "cancelled" ? [] : [{ filename: "appointment.ics", content: icsForAppointment(appointment, agencyName), contentType: "text/calendar" }],
      });
    } catch (error) {
      logger.warn("booking.email_skipped", { agencyId, appointmentId: appointment.id, reason: error.message });
    }
  }

  if (contact.phone) {
    try {
      const smsBody = kind === "cancelled"
        ? `${agencyName}: your appointment "${appointment.subject}" on ${when} has been cancelled.`
        : `${agencyName}: ${copy.title.toLowerCase()} — ${appointment.subject}, ${when}.${appointment.meetingUrl ? ` Join: ${appointment.meetingUrl}` : appointment.location ? ` Location: ${appointment.location}${appointment.locationMapsUrl ? ` Maps: ${appointment.locationMapsUrl}` : ""}` : ""}${kind !== "reminder" && manageUrl ? ` Manage: ${manageUrl}` : ""}`;
      await sendAgencyOomaSms({ agencyId, to: contact.phone, body: smsBody, idempotencyKey: `${appointment.id}:${kind}:${appointment.startsAt}` });
    } catch (error) {
      logger.warn("booking.sms_skipped", { agencyId, appointmentId: appointment.id, reason: error.message });
    }
  }

  try {
    const recipients = new Set(await adminRecipientIds(agencyId));
    if (appointment.assignedToId) recipients.add(appointment.assignedToId);
    if (actorUserId) recipients.delete(actorUserId);
    if (recipients.size) {
      await notifyUsers({
        agencyId,
        recipientIds: [...recipients],
        actorUserId,
        type: `appointment.${kind}`,
        category: "appointments",
        title: `${copy.title}: ${appointment.subject}`,
        body: `${contact.name === "there" ? "A visitor" : contact.name} · ${when}${appointment.meetingUrl ? " · Online" : ""}`,
        severity: kind === "cancelled" ? "warning" : "info",
        entityType: "appointment",
        entityId: appointment.id,
        actionUrl: "/app/calendar",
      });
    }
  } catch (error) {
    logger.warn("booking.staff_notify_skipped", { agencyId, appointmentId: appointment.id, reason: error.message });
  }
}

async function runReminderPass() {
  const now = new Date();
  const horizon = new Date(now.getTime() + 7 * 24 * 60 * 60_000);
  const due = await prisma.appointment.findMany({
    where: { status: "Scheduled", reminderSentAt: null, startsAt: { gt: now, lt: horizon } },
    include: { client: { select: { fullName: true, email: true, phone: true } } },
    take: 200,
  });
  if (!due.length) return;
  const settingsByAgency = new Map();
  for (const appointment of due) {
    if (!settingsByAgency.has(appointment.agencyId)) {
      settingsByAgency.set(appointment.agencyId, await prisma.bookingSettings.findUnique({ where: { agencyId: appointment.agencyId } }));
    }
    const settings = settingsByAgency.get(appointment.agencyId);
    const leadMs = (settings?.reminderMinutes || 1440) * 60_000;
    if (new Date(appointment.startsAt).getTime() - now.getTime() > leadMs) continue;
    const claimed = await prisma.appointment.updateMany({
      where: { id: appointment.id, reminderSentAt: null },
      data: { reminderSentAt: now },
    });
    if (!claimed.count) continue;
    await sendBookingMessages({ agencyId: appointment.agencyId, appointment, kind: "reminder" }).catch((error) => {
      logger.warn("booking.reminder_failed", { appointmentId: appointment.id, reason: error.message });
    });
  }
}

export function startBookingReminderWorker() {
  if (reminderTimer) return;
  reminderTimer = setInterval(() => {
    runReminderPass().catch((error) => logger.warn("booking.reminder_pass_failed", { reason: error.message }));
  }, REMINDER_POLL_MS);
  if (reminderTimer.unref) reminderTimer.unref();
}

export function stopBookingReminderWorker() {
  if (reminderTimer) clearInterval(reminderTimer);
  reminderTimer = null;
}
