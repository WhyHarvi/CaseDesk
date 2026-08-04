import { createHash } from "node:crypto";
import prisma from "./prisma/client.js";
import { logger } from "./logger.js";
import { createMailTransport, resolveAgencyMailConfig } from "./agencyMailService.js";
import { sendAgencyOomaSms } from "./agencyOomaService.js";
import { notifyUsers, schedulingCoordinatorRecipientIds } from "./notificationService.js";
import { releaseExpiredWaitlistHolds } from "./bookingWaitlistService.js";
import { publicBookingManageUrl, publicBookingPageUrl } from "./bookingPublicLinkService.js";
import { AVATAR_BUCKET, downloadStorageFile } from "./supabaseStorage.js";
import { MEETING_MODES, meetingModeLabel, normalizeMeetingMode } from "./bookingMeetingModeService.js";

const REMINDER_POLL_MS = 5 * 60_000;
let reminderTimer = null;
let deliveryRunning = false;
let deliveryRerunRequested = false;

function icsDate(value) {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function appointmentMeetingMode(appointment) {
  return normalizeMeetingMode(
    appointment?.meetingMode,
    appointment?.meetingUrl ? MEETING_MODES.JITSI : MEETING_MODES.IN_PERSON,
  );
}

export function bookingMessageRevision(appointment) {
  const timestamp = (value) => {
    const date = new Date(value || 0);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  };
  return createHash("sha256").update(JSON.stringify({
    status: appointment?.status || "",
    startsAt: timestamp(appointment?.startsAt),
    endsAt: timestamp(appointment?.endsAt),
    meetingMode: appointmentMeetingMode(appointment),
    meetingUrl: appointment?.meetingUrl || "",
    meetingPhoneNumber: appointment?.meetingPhoneNumber || "",
    locationId: appointment?.locationId || "",
    location: appointment?.location || "",
    assignedToId: appointment?.assignedToId || "",
  })).digest("hex").slice(0, 24);
}

function icsText(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

export function icsForAppointment(appointment, agencyName) {
  const cancelled = appointment.status === "Cancelled";
  const mode = appointmentMeetingMode(appointment);
  const clientPhone = recipientContact(appointment).phone;
  const phoneDescription = mode === MEETING_MODES.PHONE
    ? `${agencyName || "Our office"} will call${clientPhone ? ` ${clientPhone}` : " you"}${appointment.meetingPhoneNumber ? ` from ${appointment.meetingPhoneNumber}` : ""}.`
    : null;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CaseDesk//Booking//EN",
    cancelled ? "METHOD:CANCEL" : "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${appointment.id}@casedesk`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(appointment.startsAt)}`,
    `DTEND:${icsDate(appointment.endsAt)}`,
    `SUMMARY:${icsText(`${appointment.subject || "Appointment"} — ${agencyName || "CaseDesk"}`)}`,
    mode === MEETING_MODES.PHONE
      ? "LOCATION:Phone call"
      : appointment.meetingUrl
        ? `LOCATION:${icsText(meetingModeLabel(mode))}`
        : appointment.location
          ? `LOCATION:${icsText(appointment.location)}`
          : null,
    appointment.meetingUrl ? `DESCRIPTION:${icsText(`Join ${meetingModeLabel(mode)}: ${appointment.meetingUrl}`)}` : null,
    phoneDescription ? `DESCRIPTION:${icsText(phoneDescription)}` : null,
    cancelled ? "STATUS:CANCELLED" : "STATUS:CONFIRMED",
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
  booked: { title: "Appointment confirmed", eyebrow: "You're all set", intro: "Your appointment has been reserved. We look forward to meeting you.", accent: "#059669", tint: "#ecfdf5", symbol: "✓" },
  rescheduled: { title: "Appointment rescheduled", eyebrow: "Schedule updated", intro: "Your appointment has been moved to the new date and time below.", accent: "#d97706", tint: "#fffbeb", symbol: "↻" },
  format_updated: { title: "Appointment format updated", eyebrow: "Attendance updated", intro: "How you will attend has changed. Your appointment date and time remain the same.", accent: "#2563eb", tint: "#eff6ff", symbol: "↻" },
  assignment_updated: { title: "Appointment consultant updated", eyebrow: "Consultant updated", intro: "The consultant for your appointment has changed. Your appointment date, time, and format remain the same.", accent: "#2563eb", tint: "#eff6ff", symbol: "↻" },
  meeting_updated: { title: "Zoom link updated", eyebrow: "Meeting access updated", intro: "Your appointment time has not changed. Please use the updated Zoom link below.", accent: "#2563eb", tint: "#eff6ff", symbol: "↻" },
  cancelled: { title: "Appointment cancelled", eyebrow: "Booking cancelled", intro: "This appointment is no longer scheduled. Please contact us if you would like to book another time.", accent: "#e11d48", tint: "#fff1f2", symbol: "×" },
  reminder: { title: "Appointment reminder", eyebrow: "Coming up soon", intro: "A friendly reminder about your upcoming appointment.", accent: "#2563eb", tint: "#eff6ff", symbol: "•" },
  confirmed: { title: "Attendance confirmed", eyebrow: "Guest response", intro: "The guest confirmed that they will attend their appointment.", accent: "#059669", tint: "#ecfdf5", symbol: "✓" },
  attended: { title: "Appointment attended", eyebrow: "Attendance updated", intro: "The appointment was marked as attended.", accent: "#059669", tint: "#ecfdf5", symbol: "✓" },
  no_show: { title: "Appointment marked no-show", eyebrow: "Attendance updated", intro: "The guest did not attend the appointment.", accent: "#d97706", tint: "#fffbeb", symbol: "!" },
  payment_requested: { title: "Consultation payment requested", eyebrow: "Payment due", intro: "Please pay your consultation fee using the secure link below.", accent: "#0f172a", tint: "#f1f5f9", symbol: "$" },
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function safeWebUrl(value) {
  if (!value) return null;
  try {
    const parsed = new URL(String(value));
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

function safeEmailImageUrl(value) {
  const normalized = String(value || "");
  if (/^cid:[a-z0-9._@-]+$/i.test(normalized)) return normalized;
  if (/^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(normalized)) return normalized;
  return safeWebUrl(normalized);
}

function workspaceAvatarDataUrl(agency, buffer) {
  const mimeType = ["image/jpeg", "image/png", "image/webp"].includes(agency?.avatarMimeType)
    ? agency.avatarMimeType
    : "image/png";
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

async function workspaceAvatarBuffer(agency, agencyId) {
  if (!agency?.avatarStorageKey) return null;
  try {
    return await downloadStorageFile(AVATAR_BUCKET, agency.avatarStorageKey, { allowMissing: true });
  } catch (error) {
    logger.warn("booking.workspace_avatar_unavailable", { agencyId, reason: error.message });
    return null;
  }
}

function appointmentDateParts(appointment, timezone) {
  const start = new Date(appointment.startsAt);
  const end = new Date(appointment.endsAt);
  return {
    date: start.toLocaleDateString("en-CA", { timeZone: timezone, weekday: "long", month: "long", day: "numeric", year: "numeric" }),
    time: `${start.toLocaleTimeString("en-CA", { timeZone: timezone, hour: "numeric", minute: "2-digit" })} – ${end.toLocaleTimeString("en-CA", { timeZone: timezone, hour: "numeric", minute: "2-digit" })}`,
    timezoneLabel: timezone.replace(/_/g, " "),
  };
}

function detailRow(label, value) {
  if (!value) return "";
  return `<tr><td style="padding:0 0 15px;vertical-align:top;width:92px;color:#64748b;font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase">${escapeHtml(label)}</td><td style="padding:0 0 15px;vertical-align:top;color:#0f172a;font-size:15px;font-weight:600;line-height:1.45">${escapeHtml(value)}</td></tr>`;
}

function detailLinkRow(label, text, url) {
  if (!text) return "";
  const safeUrl = safeWebUrl(url);
  const valueHtml = safeUrl
    ? `<a href="${escapeHtml(safeUrl)}" style="color:#0f172a;text-decoration:underline">${escapeHtml(text)}</a>`
    : escapeHtml(text);
  return `<tr><td style="padding:0 0 15px;vertical-align:top;width:92px;color:#64748b;font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase">${escapeHtml(label)}</td><td style="padding:0 0 15px;vertical-align:top;color:#0f172a;font-size:15px;font-weight:600;line-height:1.45">${valueHtml}</td></tr>`;
}

export function bookingEmailContent({ appointment, kind, agency, timezone, contactName, manageUrl, brandImageUrl = null, messageTemplates = {}, phoneCallInstructions = null, payNowUrl = null, amount = null, invoiceUrl = null, refundEstimate = null }) {
  const template = messageTemplates?.[kind] && typeof messageTemplates[kind] === "object" ? messageTemplates[kind] : {};
  const copy = { ...(KIND_COPY[kind] || KIND_COPY.booked), ...(template.subject ? { title: String(template.subject).slice(0, 140) } : {}), ...(template.intro ? { intro: String(template.intro).slice(0, 600) } : {}) };
  const agencyName = agency?.legalName || agency?.name || "CaseDesk";
  const subject = appointment.subject || "Appointment";
  const mode = appointmentMeetingMode(appointment);
  const modeLabel = meetingModeLabel(mode);
  const clientPhone = recipientContact(appointment).phone;
  const { date, time, timezoneLabel } = appointmentDateParts(appointment, timezone);
  const meetingUrl = safeWebUrl(appointment.meetingUrl);
  const mapsUrl = appointment.location
    ? safeWebUrl(appointment.locationMapsUrl) || `https://maps.google.com/?q=${encodeURIComponent(appointment.location.split(" — ").pop())}`
    : null;
  const safeManageUrl = safeWebUrl(manageUrl);
  const workspaceAvatarUrl = safeEmailImageUrl(brandImageUrl);
  const logoUrl = workspaceAvatarUrl || safeWebUrl(agency?.logoUrl);
  const inPerson = mode === MEETING_MODES.IN_PERSON ? appointment.location : null;
  const phoneSummary = mode === MEETING_MODES.PHONE
    ? `${agencyName} will call${clientPhone ? ` ${clientPhone}` : " you"}${appointment.meetingPhoneNumber ? ` from ${appointment.meetingPhoneNumber}` : ""}.`
    : null;
  const safePayNowUrl = kind === "payment_requested" ? safeWebUrl(payNowUrl) : null;
  const primaryUrl = kind === "cancelled" ? null : (safePayNowUrl || meetingUrl || mapsUrl || safeManageUrl);
  const primaryLabel = safePayNowUrl
    ? "Pay consultation fee"
    : meetingUrl
      ? `Join ${mode === MEETING_MODES.ZOOM ? "Zoom" : "Jitsi"} appointment`
      : mapsUrl
        ? "Open directions"
        : "Manage appointment";
  const showManageButton = kind !== "cancelled" && safeManageUrl && safeManageUrl !== primaryUrl;
  const agencyContact = [agency?.phone, agency?.email].filter(Boolean).join(" · ");
  const agencyAddress = [agency?.address, agency?.city, agency?.province, agency?.postalCode].filter(Boolean).join(", ");
  const brandMark = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" width="46" height="46" alt="${escapeHtml(agencyName)}" style="display:block;width:46px;height:46px;border-radius:${workspaceAvatarUrl ? "50%" : "13px"};background:#ffffff;object-fit:${workspaceAvatarUrl ? "cover" : "contain"}">`
    : `<div style="width:46px;height:46px;border-radius:13px;background:#ffffff;color:#0f172a;font-size:20px;font-weight:800;line-height:46px;text-align:center">${escapeHtml(agencyName.charAt(0).toUpperCase())}</div>`;

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(copy.title)}</title>
<style>@media only screen and (max-width:620px){.email-shell{padding:16px 8px!important}.email-card{border-radius:22px!important}.content-pad{padding-left:22px!important;padding-right:22px!important}.action-button{display:block!important;width:auto!important;text-align:center!important}.secondary-action{margin-left:0!important;margin-top:10px!important}.brand-name{font-size:16px!important}}</style></head>
<body style="margin:0;padding:0;background:#f1f5f9;color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(copy.intro)} ${escapeHtml(date)} at ${escapeHtml(time)}.</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f1f5f9"><tr><td class="email-shell" align="center" style="padding:38px 14px">
    <table role="presentation" class="email-card" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e2e8f0;border-radius:28px;overflow:hidden;box-shadow:0 18px 55px rgba(15,23,42,.09)">
      <tr><td class="content-pad" style="padding:24px 34px;background:#0f172a">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="58">${brandMark}</td><td class="brand-name" style="color:#ffffff;font-size:18px;font-weight:750;letter-spacing:-.01em">${escapeHtml(agencyName)}</td><td align="right" style="color:#94a3b8;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">Appointment</td></tr></table>
      </td></tr>
      <tr><td class="content-pad" style="padding:36px 34px 10px">
        <div style="display:inline-block;width:46px;height:46px;border-radius:50%;background:${copy.tint};color:${copy.accent};font-size:25px;font-weight:800;line-height:46px;text-align:center">${copy.symbol}</div>
        <p style="margin:20px 0 8px;color:${copy.accent};font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase">${escapeHtml(copy.eyebrow)}</p>
        <h1 style="margin:0;color:#0f172a;font-size:30px;line-height:1.18;letter-spacing:-.035em;font-weight:750">${escapeHtml(copy.title)}</h1>
        <p style="margin:14px 0 0;color:#475569;font-size:16px;line-height:1.65">Hi ${escapeHtml(contactName)},<br>${escapeHtml(copy.intro)}</p>
      </td></tr>
      <tr><td class="content-pad" style="padding:24px 34px 8px">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border:1px solid #e2e8f0;border-radius:20px;background:#f8fafc">
          <tr><td style="padding:23px 24px 8px"><p style="margin:0 0 20px;color:#0f172a;font-size:19px;font-weight:750;line-height:1.35">${escapeHtml(subject)}</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              ${kind === "payment_requested" && amount ? detailRow("Amount due", `$${Number(amount).toFixed(2)}`) : ""}
              ${(kind === "booked" || kind === "cancelled") && amount ? detailRow("Amount paid", `$${Number(amount).toFixed(2)}`) : ""}
              ${kind === "booked" && amount && invoiceUrl ? detailLinkRow("Receipt", "View invoice in QuickBooks", invoiceUrl) : ""}
              ${detailRow("Date", date)}
              ${detailRow("Time", `${time} (${timezoneLabel})`)}
              ${detailRow("Format", modeLabel)}
              ${inPerson ? detailRow("Location", inPerson) : ""}
              ${phoneSummary ? detailRow("Call details", phoneSummary) : ""}
              ${appointment.assignedTo?.fullName ? detailRow("With", appointment.assignedTo.fullName) : ""}
              ${appointment.referenceCode ? detailRow("Reference", appointment.referenceCode) : ""}
            </table>
          </td></tr>
        </table>
      </td></tr>
      ${kind !== "cancelled" && mode === MEETING_MODES.PHONE && phoneCallInstructions ? `<tr><td class="content-pad" style="padding:18px 34px 0"><div style="border-radius:18px;background:#eff6ff;border:1px solid #bfdbfe;padding:18px"><p style="margin:0;color:#1d4ed8;font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.08em">Phone appointment</p><p style="margin:9px 0 0;color:#475569;font-size:14px;line-height:1.6">${escapeHtml(phoneCallInstructions)}</p></div></td></tr>` : ""}
      ${kind === "cancelled" && refundEstimate ? `<tr><td class="content-pad" style="padding:18px 34px 0"><div style="border-radius:18px;background:#fffbeb;border:1px solid #fde68a;padding:18px"><p style="margin:0;color:#92400e;font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.08em">About your refund</p><p style="margin:9px 0 0;color:#475569;font-size:14px;line-height:1.6">You paid $${Number(refundEstimate.paid).toFixed(2)}. QuickBooks processing fees mean you'll receive approximately <strong>$${Number(refundEstimate.estimatedRefund).toFixed(2)}</strong> back, not the full amount. Our team will process this in QuickBooks and follow up.</p></div></td></tr>` : ""}
      ${primaryUrl ? `<tr><td class="content-pad" style="padding:18px 34px 0"><a class="action-button" href="${escapeHtml(primaryUrl)}" style="display:inline-block;border-radius:999px;background:#0f172a;color:#ffffff;text-decoration:none;padding:14px 22px;font-size:14px;font-weight:750">${escapeHtml(primaryLabel)} &nbsp;→</a>${showManageButton ? `<a class="action-button secondary-action" href="${escapeHtml(safeManageUrl)}" style="display:inline-block;margin-left:10px;color:#334155;text-decoration:none;padding:13px 8px;font-size:14px;font-weight:700">Reschedule or cancel</a>` : ""}</td></tr>` : ""}
      ${kind !== "cancelled" && (appointment.sessionType?.preparationInstructions || appointment.sessionType?.preparationChecklist?.length || (appointment.sessionType?.parkingInstructions && mode === MEETING_MODES.IN_PERSON)) ? `<tr><td class="content-pad" style="padding:22px 34px 0"><div style="border-radius:18px;background:#fffbeb;border:1px solid #fde68a;padding:18px"><p style="margin:0;color:#92400e;font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.08em">Before your appointment</p>${appointment.sessionType?.preparationInstructions ? `<p style="margin:9px 0 0;color:#475569;font-size:14px;line-height:1.6">${escapeHtml(appointment.sessionType.preparationInstructions)}</p>` : ""}${appointment.sessionType?.preparationChecklist?.length ? `<ul style="margin:9px 0 0;padding-left:20px;color:#475569;font-size:14px;line-height:1.7">${appointment.sessionType.preparationChecklist.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}${appointment.sessionType?.parkingInstructions && mode === MEETING_MODES.IN_PERSON ? `<p style="margin:9px 0 0;color:#64748b;font-size:13px;line-height:1.5"><strong>Arrival:</strong> ${escapeHtml(appointment.sessionType.parkingInstructions)}</p>` : ""}</div></td></tr>` : ""}
      <tr><td class="content-pad" style="padding:28px 34px 34px"><p style="margin:0;color:#64748b;font-size:13px;line-height:1.6">${kind === "cancelled" ? "No action is required." : "A calendar file is attached so you can add this appointment to your calendar."}</p></td></tr>
      <tr><td class="content-pad" style="padding:23px 34px;background:#f8fafc;border-top:1px solid #e2e8f0"><p style="margin:0;color:#334155;font-size:13px;font-weight:700">${escapeHtml(agencyName)}</p>${agencyContact ? `<p style="margin:6px 0 0;color:#64748b;font-size:12px;line-height:1.5">${escapeHtml(agencyContact)}</p>` : ""}${agencyAddress ? `<p style="margin:3px 0 0;color:#94a3b8;font-size:12px;line-height:1.5">${escapeHtml(agencyAddress)}</p>` : ""}</td></tr>
    </table>
    <p style="margin:18px 0 0;color:#94a3b8;font-size:11px">Sent securely by CaseDesk</p>
  </td></tr></table>
</body></html>`;

  const accessLine = meetingUrl
    ? `Join ${modeLabel}: ${meetingUrl}`
    : phoneSummary
      ? `Call details: ${phoneSummary}`
      : appointment.location
      ? `Location: ${appointment.location}${mapsUrl ? `\nDirections: ${mapsUrl}` : ""}`
      : null;
  const text = [
    copy.title,
    "",
    `Hi ${contactName},`,
    copy.intro,
    "",
    subject,
    kind === "payment_requested" && amount ? `Amount due: $${Number(amount).toFixed(2)}` : null,
    kind === "payment_requested" && safePayNowUrl ? `Pay now: ${safePayNowUrl}` : null,
    (kind === "booked" || kind === "cancelled") && amount ? `Amount paid: $${Number(amount).toFixed(2)}` : null,
    kind === "booked" && amount && invoiceUrl ? `Receipt: ${safeWebUrl(invoiceUrl)}` : null,
    kind === "cancelled" && refundEstimate ? `About your refund: QuickBooks processing fees mean you'll receive approximately $${Number(refundEstimate.estimatedRefund).toFixed(2)} back, not the full amount. Our team will process this in QuickBooks and follow up.` : null,
    `Date: ${date}`,
    `Time: ${time} (${timezoneLabel})`,
    `Format: ${modeLabel}`,
    accessLine,
    mode === MEETING_MODES.PHONE && phoneCallInstructions ? `Phone instructions: ${phoneCallInstructions}` : null,
    appointment.assignedTo?.fullName ? `With: ${appointment.assignedTo.fullName}` : null,
    appointment.referenceCode ? `Reference: ${appointment.referenceCode}` : null,
    appointment.sessionType?.preparationInstructions ? `Preparation: ${appointment.sessionType.preparationInstructions}` : null,
    appointment.sessionType?.preparationChecklist?.length ? `Bring: ${appointment.sessionType.preparationChecklist.join("; ")}` : null,
    appointment.sessionType?.parkingInstructions && mode === MEETING_MODES.IN_PERSON ? `Arrival: ${appointment.sessionType.parkingInstructions}` : null,
    kind !== "cancelled" && safeManageUrl ? `Manage appointment: ${safeManageUrl}` : null,
    "",
    agencyName,
    agencyContact || null,
    agencyAddress || null,
  ].filter((line) => line !== null).join("\n");

  return { subject: `${copy.title} — ${subject} on ${date}`, html, text };
}

export async function bookingTemplatePreview({ agencyId, kind = "booked", messageTemplates = null, contactName = "Jordan Lee" }) {
  const [agency, settings, consultant] = await Promise.all([
    prisma.agency.findUnique({ where: { id: agencyId }, select: { name: true, legalName: true, logoUrl: true, avatarStorageKey: true, avatarMimeType: true, phone: true, email: true, address: true, city: true, province: true, postalCode: true } }),
    prisma.bookingSettings.findUnique({ where: { agencyId } }),
    prisma.user.findFirst({ where: { agencyId, status: "active", role: { in: ["admin", "consultant"] } }, select: { fullName: true } }),
  ]);
  const avatarBuffer = await workspaceAvatarBuffer(agency, agencyId);
  const startsAt = new Date(Date.now() + 2 * 86_400_000);
  startsAt.setHours(10, 0, 0, 0);
  const appointment = {
    id: "preview",
    referenceCode: "APT-PREVIEW",
    subject: "Initial immigration consultation",
    startsAt,
    endsAt: new Date(startsAt.getTime() + 30 * 60_000),
    status: kind === "cancelled" ? "Cancelled" : "Scheduled",
    location: "Main Office — 100 King Street West, Toronto",
    locationMapsUrl: "https://maps.google.com/?q=100+King+Street+West+Toronto",
    assignedTo: { fullName: consultant?.fullName || "Immigration Consultant" },
    sessionType: { preparationInstructions: "Please arrive ten minutes early.", preparationChecklist: ["Passport or government-issued identification", "Relevant immigration documents"], parkingInstructions: "Visitor parking is available behind the building." },
  };
  return bookingEmailContent({ appointment, kind, agency, timezone: settings?.timezone || "America/Toronto", contactName, manageUrl: publicBookingManageUrl(settings, "preview"), brandImageUrl: avatarBuffer ? workspaceAvatarDataUrl(agency, avatarBuffer) : null, messageTemplates: messageTemplates || settings?.messageTemplates || {} });
}

export async function sendBookingTemplateTest({ agencyId, userId, kind, messageTemplates }) {
  const user = await prisma.user.findFirst({ where: { id: userId, agencyId }, select: { email: true, fullName: true } });
  if (!user?.email) throw new Error("Your account does not have a test email address.");
  const content = await bookingTemplatePreview({ agencyId, kind, messageTemplates, contactName: user.fullName });
  const config = await resolveAgencyMailConfig(agencyId);
  const transport = createMailTransport(config);
  await transport.sendMail({ from: config.from, to: user.email, subject: `[Test] ${content.subject}`, text: content.text, html: content.html });
  return { recipient: user.email };
}

/**
 * Sends client-facing email + SMS and staff in-app notifications for a
 * booking event. Every channel is best-effort: a missing mailbox or Ooma
 * connection never fails the booking itself.
 */
async function bookingDeliveryAllowed(deliveryId, appointmentId) {
  if (!deliveryId) return true;
  const [delivery, appointment] = await Promise.all([
    prisma.bookingMessageDelivery.findFirst({
      where: { id: deliveryId, appointmentId, status: "processing" },
      select: { id: true, kind: true, payload: true },
    }),
    prisma.appointment.findFirst({
      where: { id: appointmentId },
    }),
  ]);
  return Boolean(delivery && bookingDeliveryIsCurrent(delivery, appointment));
}

export async function deliverBookingMessages({ agencyId, appointment, kind, actorUserId = null, channel = null, dedupeSuffix = "", deliveryId = null, payNowUrl = null, amount = null, invoiceUrl = null, refundEstimate = null, includeIcs = true }) {
  const [agency, settings] = await Promise.all([
    prisma.agency.findUnique({ where: { id: agencyId }, select: { name: true, legalName: true, logoUrl: true, avatarStorageKey: true, avatarMimeType: true, phone: true, email: true, address: true, city: true, province: true, postalCode: true } }),
    prisma.bookingSettings.findUnique({ where: { agencyId } }),
  ]);
  const timezone = settings?.timezone || "America/Toronto";
  const agencyName = agency?.legalName || agency?.name || "CaseDesk";
  const contact = recipientContact(appointment);
  const copy = KIND_COPY[kind] || KIND_COPY.booked;
  const when = formatWhen(appointment, timezone);
  const manageUrl = publicBookingManageUrl(settings, appointment.manageToken);

  if (contact.email && (!channel || channel === "email")) {
    try {
      const config = await resolveAgencyMailConfig(agencyId);
      const transport = createMailTransport(config);
      const avatarBuffer = await workspaceAvatarBuffer(agency, agencyId);
      const avatarCid = avatarBuffer ? `workspace-avatar-${appointment.id}-${kind}@casedesk` : null;
      const email = bookingEmailContent({ appointment, kind, agency, timezone, contactName: contact.name, manageUrl, brandImageUrl: avatarCid ? `cid:${avatarCid}` : null, messageTemplates: settings?.messageTemplates, phoneCallInstructions: settings?.phoneCallInstructions, payNowUrl, amount, invoiceUrl, refundEstimate });
      if (!(await bookingDeliveryAllowed(deliveryId, appointment.id))) return { suppressed: true };
      await transport.sendMail({
        from: config.from,
        to: contact.email,
        messageId: `<booking-${appointment.id}-${kind}-${deliveryId || new Date(appointment.startsAt).getTime()}@casedesk>`,
        subject: email.subject,
        text: email.text,
        html: email.html,
        attachments: [
          ...(avatarBuffer ? [{
            filename: `workspace-avatar.${agency.avatarMimeType === "image/jpeg" ? "jpg" : agency.avatarMimeType === "image/webp" ? "webp" : "png"}`,
            content: avatarBuffer,
            contentType: agency.avatarMimeType || "image/png",
            cid: avatarCid,
            contentDisposition: "inline",
          }] : []),
          ...(includeIcs ? [{ filename: "appointment.ics", content: icsForAppointment(appointment, agencyName), contentType: `text/calendar; method=${kind === "cancelled" ? "CANCEL" : "PUBLISH"}` }] : []),
        ],
      });
    } catch (error) {
      logger.warn("booking.email_skipped", { agencyId, appointmentId: appointment.id, reason: error.message });
      if (channel === "email") throw error;
    }
  }

  if (contact.phone && (!channel || channel === "sms")) {
    try {
      const mode = appointmentMeetingMode(appointment);
      const smsAccess = appointment.meetingUrl
        ? ` Join ${mode === MEETING_MODES.ZOOM ? "Zoom" : "Jitsi"}: ${appointment.meetingUrl}`
        : mode === MEETING_MODES.PHONE
          ? ` ${agencyName} will call you${contact.phone ? ` at ${contact.phone}` : ""}${appointment.meetingPhoneNumber ? ` from ${appointment.meetingPhoneNumber}` : ""}.`
          : appointment.location
            ? ` Location: ${appointment.location}${appointment.locationMapsUrl ? ` Maps: ${appointment.locationMapsUrl}` : ""}`
            : "";
      const smsBody = kind === "cancelled"
        ? `${agencyName}: your appointment "${appointment.subject}" on ${when} has been cancelled.`
        : kind === "payment_requested"
          ? `${agencyName}: your consultation fee${amount ? ` of $${Number(amount).toFixed(2)}` : ""} for "${appointment.subject}" (${when}) is due. Pay now: ${payNowUrl}`
          : `${agencyName}: ${copy.title.toLowerCase()} — ${appointment.subject}, ${when}.${smsAccess}${manageUrl ? ` Manage: ${manageUrl}` : ""}`;
      if (!(await bookingDeliveryAllowed(deliveryId, appointment.id))) return { suppressed: true };
      await sendAgencyOomaSms({ agencyId, to: contact.phone, body: smsBody, idempotencyKey: `${appointment.id}:${kind}:${deliveryId || dedupeSuffix || appointment.startsAt}` });
    } catch (error) {
      logger.warn("booking.sms_skipped", { agencyId, appointmentId: appointment.id, reason: error.message });
      if (channel === "sms") throw error;
    }
  }

  if (!channel || channel === "staff") try {
    if (!(await bookingDeliveryAllowed(deliveryId, appointment.id))) return { suppressed: true };
    const paidHold = kind === "cancelled"
      ? await prisma.bookingPaymentHold.findFirst({
        where: { agencyId, appointmentId: appointment.id, status: "Paid" },
        select: { id: true, amount: true, qbInvoiceId: true },
      })
      : null;
    const coordinatorIds = await schedulingCoordinatorRecipientIds(agencyId);
    const recipients = new Set(coordinatorIds);
    if (appointment.assignedToId) recipients.add(appointment.assignedToId);
    const actorIsCoordinator = actorUserId ? coordinatorIds.includes(actorUserId) : false;
    if (actorUserId && !actorIsCoordinator) recipients.delete(actorUserId);
    if (recipients.size) {
      await notifyUsers({
        agencyId,
        recipientIds: [...recipients],
        actorUserId,
        type: `appointment.${kind}`,
        category: "appointments",
        title: paidHold ? `Paid appointment cancelled — review refund: ${appointment.subject}` : `${copy.title}: ${appointment.subject}`,
        body: `${contact.name === "there" ? "A visitor" : contact.name} · ${when} · ${meetingModeLabel(appointmentMeetingMode(appointment))}${appointment.location && appointmentMeetingMode(appointment) === MEETING_MODES.IN_PERSON ? ` · ${appointment.location}` : ""}${paidHold ? ` · $${Number(paidHold.amount).toFixed(2)} was paid${paidHold.qbInvoiceId ? ` on QuickBooks invoice ${paidHold.qbInvoiceId}` : ""}. Review the cancellation terms and issue a QuickBooks refund when required.` : ""}`,
        severity: ["cancelled", "no_show"].includes(kind) ? "warning" : "info",
        entityType: "appointment",
        entityId: appointment.id,
        actionUrl: `/app/calendar?appointment=${encodeURIComponent(appointment.id)}&date=${new Date(appointment.startsAt).toISOString().slice(0, 10)}`,
        metadata: {
          appointmentId: appointment.id,
          startsAt: new Date(appointment.startsAt).toISOString(),
          assignedToId: appointment.assignedToId || null,
          kind,
          paidCancellationReview: Boolean(paidHold),
          paymentHoldId: paidHold?.id || null,
          qbInvoiceId: paidHold?.qbInvoiceId || null,
        },
        dedupeKey: `appointment:${appointment.id}:${kind}:${deliveryId || `${new Date(appointment.startsAt).toISOString()}:${dedupeSuffix || "base"}`}:staff`,
        includeActor: actorIsCoordinator,
      });
    }
  } catch (error) {
    logger.warn("booking.staff_notify_skipped", { agencyId, appointmentId: appointment.id, reason: error.message });
    if (channel === "staff") throw error;
  }
  return { suppressed: false };
}

export async function cancelQueuedBookingReminders(appointmentIds, db = prisma) {
  const ids = [...new Set((Array.isArray(appointmentIds) ? appointmentIds : [appointmentIds]).filter(Boolean))];
  if (!ids.length) return 0;
  const result = await db.bookingMessageDelivery.updateMany({
    where: {
      appointmentId: { in: ids },
      kind: "reminder",
      status: { in: ["pending", "processing"] },
    },
    data: { status: "cancelled", failedAt: null, lastError: null },
  });
  return result.count;
}

export async function sendBookingMessages({ agencyId, appointment, kind, actorUserId = null, dedupeSuffix = "", db = prisma, payNowUrl = null, amount = null, invoiceUrl = null, refundEstimate = null }) {
  if (kind === "cancelled") await cancelQueuedBookingReminders(appointment.id, db);
  const contact = recipientContact(appointment);
  const startsAtVersion = new Date(appointment.startsAt).toISOString();
  const revision = bookingMessageRevision(appointment);
  const jobs = [
    contact.email ? { channel: "email", recipient: contact.email } : null,
    contact.phone ? { channel: "sms", recipient: contact.phone } : null,
    kind !== "reminder" ? { channel: "staff", recipient: `workspace:${agencyId}` } : null,
  ].filter(Boolean);
  if (jobs.length) {
    await db.bookingMessageDelivery.createMany({
      data: jobs.map((job) => ({
        agencyId,
        appointmentId: appointment.id,
        kind,
        channel: job.channel,
        recipient: job.recipient,
        dedupeKey: `${appointment.id}:${kind}:${job.channel}:${revision}${dedupeSuffix ? `:${dedupeSuffix}` : ""}`,
        payload: { actorUserId, dedupeSuffix, appointmentStartsAt: startsAtVersion, appointmentRevision: revision, ...(payNowUrl ? { payNowUrl } : {}), ...(amount != null ? { amount } : {}), ...(invoiceUrl ? { invoiceUrl } : {}), ...(refundEstimate ? { refundEstimate } : {}) },
      })),
      skipDuplicates: true,
    });
  }
  if (db === prisma) void processBookingDeliveryPass();
}

export async function sendBookingStaffNotification({ agencyId, appointment, kind, actorUserId = null, dedupeSuffix = "", db = prisma }) {
  const startsAtVersion = new Date(appointment.startsAt).toISOString();
  const revision = bookingMessageRevision(appointment);
  await db.bookingMessageDelivery.createMany({
    data: [{
      agencyId,
      appointmentId: appointment.id,
      kind,
      channel: "staff",
      recipient: `workspace:${agencyId}`,
      dedupeKey: `${appointment.id}:${kind}:staff:${revision}${dedupeSuffix ? `:${dedupeSuffix}` : ""}`,
      payload: { actorUserId, dedupeSuffix, appointmentStartsAt: startsAtVersion, appointmentRevision: revision },
    }],
    skipDuplicates: true,
  });
  if (db === prisma) void processBookingDeliveryPass();
}

// A BookingPaymentHold that expires/voids unpaid never became a real
// Appointment (see captureAbandonedPublicBookingLead in lead.booking.js,
// which this feeds), so this is deliberately NOT built on top of
// bookingEmailContent()/deliverBookingMessages() above — those assume a
// real, confirmed appointment throughout (date/time/location detail rows,
// an ICS attachment, SMS + staff-notification + delivery-queue
// orchestration). Reusing them here would risk implying a booking was
// actually held. This is its own small, simpler template instead: no
// confirmed date/time to show, just a link back to book again.
export async function sendAbandonedBookingPaymentEmail({ agencyId, hold, sessionType = null }) {
  if (!hold?.guestEmail) return { skipped: true };
  const [agency, settings] = await Promise.all([
    prisma.agency.findUnique({ where: { id: agencyId }, select: { name: true, legalName: true, logoUrl: true, avatarStorageKey: true, avatarMimeType: true, phone: true, email: true, address: true, city: true, province: true, postalCode: true } }),
    prisma.bookingSettings.findUnique({ where: { agencyId } }),
  ]);
  const agencyName = agency?.legalName || agency?.name || "CaseDesk";
  const contactName = hold.guestName || "there";
  const sessionLabel = sessionType?.name || "consultation";
  const bookingUrl = safeWebUrl(publicBookingPageUrl(settings));
  const feeLine = hold.amount ? ` for the $${Number(hold.amount).toFixed(2)} fee` : "";
  const agencyContact = [agency?.phone, agency?.email].filter(Boolean).join(" · ");
  const agencyAddress = [agency?.address, agency?.city, agency?.province, agency?.postalCode].filter(Boolean).join(", ");

  const config = await resolveAgencyMailConfig(agencyId);
  const transport = createMailTransport(config);
  const avatarBuffer = await workspaceAvatarBuffer(agency, agencyId);
  const avatarCid = avatarBuffer ? `workspace-avatar-${hold.id}-payment-abandoned@casedesk` : null;
  const logoUrl = avatarCid ? `cid:${avatarCid}` : safeWebUrl(agency?.logoUrl);
  const brandMark = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" width="46" height="46" alt="${escapeHtml(agencyName)}" style="display:block;width:46px;height:46px;border-radius:${avatarCid ? "50%" : "13px"};background:#ffffff;object-fit:${avatarCid ? "cover" : "contain"}">`
    : `<div style="width:46px;height:46px;border-radius:13px;background:#ffffff;color:#0f172a;font-size:20px;font-weight:800;line-height:46px;text-align:center">${escapeHtml(agencyName.charAt(0).toUpperCase())}</div>`;

  const subject = `You can still book with ${agencyName}`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f1f5f9"><tr><td align="center" style="padding:38px 14px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e2e8f0;border-radius:28px;overflow:hidden;box-shadow:0 18px 55px rgba(15,23,42,.09)">
      <tr><td style="padding:24px 34px;background:#0f172a">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="58">${brandMark}</td><td style="color:#ffffff;font-size:18px;font-weight:750;letter-spacing:-.01em">${escapeHtml(agencyName)}</td></tr></table>
      </td></tr>
      <tr><td style="padding:36px 34px 10px">
        <p style="margin:0 0 8px;color:#0f172a;font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase">Still available</p>
        <h1 style="margin:0;color:#0f172a;font-size:26px;line-height:1.3;letter-spacing:-.03em;font-weight:750">You can still book your ${escapeHtml(sessionLabel)}</h1>
        <p style="margin:14px 0 0;color:#475569;font-size:16px;line-height:1.65">Hi ${escapeHtml(contactName)},<br>It looks like we couldn't complete payment${escapeHtml(feeLine)}, so that time wasn't held for you. No problem — you're welcome to book a new time whenever works.</p>
      </td></tr>
      ${bookingUrl ? `<tr><td style="padding:18px 34px 0"><a href="${escapeHtml(bookingUrl)}" style="display:inline-block;border-radius:999px;background:#0f172a;color:#ffffff;text-decoration:none;padding:14px 22px;font-size:14px;font-weight:750">Book a new time &nbsp;→</a></td></tr>` : ""}
      <tr><td style="padding:28px 34px 34px"><p style="margin:0;color:#64748b;font-size:13px;line-height:1.6">If you already sorted this out or have questions, just reach out — we're happy to help.</p></td></tr>
      <tr><td style="padding:23px 34px;background:#f8fafc;border-top:1px solid #e2e8f0"><p style="margin:0;color:#334155;font-size:13px;font-weight:700">${escapeHtml(agencyName)}</p>${agencyContact ? `<p style="margin:6px 0 0;color:#64748b;font-size:12px;line-height:1.5">${escapeHtml(agencyContact)}</p>` : ""}${agencyAddress ? `<p style="margin:3px 0 0;color:#94a3b8;font-size:12px;line-height:1.5">${escapeHtml(agencyAddress)}</p>` : ""}</td></tr>
    </table>
    <p style="margin:18px 0 0;color:#94a3b8;font-size:11px">Sent securely by CaseDesk</p>
  </td></tr></table>
</body></html>`;

  const text = [
    `You can still book your ${sessionLabel}`,
    "",
    `Hi ${contactName},`,
    `It looks like we couldn't complete payment${feeLine}, so that time wasn't held for you. No problem — you're welcome to book a new time whenever works.`,
    bookingUrl ? `Book a new time: ${bookingUrl}` : null,
    "",
    agencyName,
    agencyContact || null,
  ].filter(Boolean).join("\n");

  await transport.sendMail({
    from: config.from,
    to: hold.guestEmail,
    messageId: `<booking-hold-${hold.id}-payment-abandoned@casedesk>`,
    subject,
    text,
    html,
    attachments: avatarBuffer ? [{
      filename: `workspace-avatar.${agency.avatarMimeType === "image/jpeg" ? "jpg" : agency.avatarMimeType === "image/webp" ? "webp" : "png"}`,
      content: avatarBuffer,
      contentType: agency.avatarMimeType || "image/png",
      cid: avatarCid,
      contentDisposition: "inline",
    }] : [],
  });
  return { sent: true };
}

export function bookingDeliveryIsCurrent(job, appointment) {
  if (!appointment) return false;
  let expectedStatus = "Scheduled";
  if (job.kind === "cancelled") expectedStatus = "Cancelled";
  else if (job.kind === "no_show") expectedStatus = "NoShow";
  else if (job.kind === "attended") expectedStatus = "Completed";
  const stateMatches = appointment.status === expectedStatus;
  if (!stateMatches) return false;
  if (
    job.payload?.appointmentRevision
    && job.payload.appointmentRevision !== bookingMessageRevision(appointment)
  ) return false;
  if (
    ["booked", "rescheduled", "format_updated", "assignment_updated", "meeting_updated"].includes(job.kind)
    && job.payload?.appointmentStartsAt
    && new Date(job.payload.appointmentStartsAt).getTime() !== new Date(appointment.startsAt).getTime()
  ) return false;
  return true;
}

async function processBookingDeliveryPass() {
  if (deliveryRunning) {
    deliveryRerunRequested = true;
    return;
  }
  deliveryRunning = true;
  try {
    const now = new Date();
    const jobs = await prisma.bookingMessageDelivery.findMany({
      where: {
        availableAt: { lte: now },
        OR: [
          { status: "pending" },
          { status: "processing", updatedAt: { lt: new Date(now.getTime() - 10 * 60_000) } },
        ],
      },
      orderBy: { availableAt: "asc" },
      take: 50,
    });
    for (const job of jobs) {
      const claimed = await prisma.bookingMessageDelivery.updateMany({
        where: { id: job.id, status: job.status, updatedAt: job.updatedAt },
        data: { status: "processing", attempts: { increment: 1 } },
      });
      if (!claimed.count) continue;
      try {
        const appointment = await prisma.appointment.findUnique({
          where: { id: job.appointmentId },
          include: { client: { select: { fullName: true, email: true, phone: true } }, assignedTo: { select: { id: true, fullName: true } }, sessionType: { select: { preparationInstructions: true, preparationChecklist: true, parkingInstructions: true } } },
        });
        if (!appointment) throw new Error("Appointment no longer exists");
        if (!bookingDeliveryIsCurrent(job, appointment)) {
          await prisma.bookingMessageDelivery.updateMany({
            where: { id: job.id, status: "processing" },
            data: { status: "cancelled", failedAt: null, lastError: null },
          });
          continue;
        }
        const delivery = await deliverBookingMessages({
          agencyId: job.agencyId,
          appointment,
          kind: job.kind,
          actorUserId: job.payload?.actorUserId || null,
          channel: job.channel,
          dedupeSuffix: job.payload?.dedupeSuffix || "",
          deliveryId: job.id,
          payNowUrl: job.payload?.payNowUrl || null,
          amount: job.payload?.amount ?? null,
          invoiceUrl: job.payload?.invoiceUrl || null,
          refundEstimate: job.payload?.refundEstimate || null,
        });
        if (delivery?.suppressed) {
          await prisma.bookingMessageDelivery.updateMany({
            where: { id: job.id, status: "processing" },
            data: { status: "cancelled", failedAt: null, lastError: null },
          });
          continue;
        }
        const sent = await prisma.bookingMessageDelivery.updateMany({
          where: { id: job.id, status: "processing" },
          data: { status: "sent", sentAt: new Date(), lastError: null },
        });
        if (!sent.count) continue;
        if (job.kind === "reminder") {
          const remaining = await prisma.bookingMessageDelivery.count({ where: { appointmentId: job.appointmentId, kind: "reminder", status: { not: "sent" } } });
          if (!remaining) await prisma.appointment.update({ where: { id: job.appointmentId }, data: { reminderSentAt: new Date() } });
        }
      } catch (error) {
        const attempts = job.attempts + 1;
        const exhausted = attempts >= job.maxAttempts;
        const failed = await prisma.bookingMessageDelivery.updateMany({
          where: { id: job.id, status: "processing" },
          data: {
            status: exhausted ? "failed" : "pending",
            failedAt: exhausted ? new Date() : null,
            lastError: String(error.message || error).slice(0, 1000),
            availableAt: new Date(Date.now() + Math.min(60, 2 ** attempts) * 60_000),
          },
        });
        if (!failed.count) continue;
        if (exhausted) {
          await notifyUsers({
            agencyId: job.agencyId,
            recipientIds: await schedulingCoordinatorRecipientIds(job.agencyId),
            type: "appointment.delivery_failed",
            category: "appointments",
            title: "Appointment message delivery failed",
            body: `${job.channel.toUpperCase()} delivery failed after ${attempts} attempts.`,
            severity: "critical",
            entityType: "appointment",
            entityId: job.appointmentId,
            actionUrl: "/app/calendar",
            dedupeKey: `appointment:${job.appointmentId}:delivery:${job.id}:failed`,
            channels: ["in_app"],
          }).catch(() => {});
        }
      }
    }
    // Drain another batch immediately, and also honor jobs queued while this
    // pass was already running. Otherwise they could wait for the five-minute
    // reminder timer even though their booking request asked for an
    // immediate delivery pass.
    if (jobs.length === 50) deliveryRerunRequested = true;
  } finally {
    deliveryRunning = false;
    if (deliveryRerunRequested) {
      deliveryRerunRequested = false;
      void processBookingDeliveryPass();
    }
  }
}

export function processBookingMessageDeliveries() {
  return processBookingDeliveryPass();
}

async function runReminderPass() {
  const now = new Date();
  const horizon = new Date(now.getTime() + 7 * 86_400_000);
  const scheduleByAgency = new Map();
  let reminderCursor = null;
  while (true) {
    const due = await prisma.appointment.findMany({
      where: {
        status: "Scheduled",
        startsAt: { gt: now, lte: horizon },
        ...(reminderCursor ? {
          OR: [
            { startsAt: { gt: reminderCursor.startsAt, lte: horizon } },
            { startsAt: reminderCursor.startsAt, id: { gt: reminderCursor.id } },
          ],
        } : {}),
      },
      include: { client: { select: { fullName: true, email: true, phone: true } } },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      take: 500,
    });
    if (!due.length) break;
    const missingAgencyIds = [...new Set(due.map((item) => item.agencyId))]
      .filter((agencyId) => !scheduleByAgency.has(agencyId));
    for (const agencyId of missingAgencyIds) scheduleByAgency.set(agencyId, [1440]);
    if (missingAgencyIds.length) {
      const settingsRows = await prisma.bookingSettings.findMany({
        where: { agencyId: { in: missingAgencyIds } },
        select: { agencyId: true, reminderMinutes: true, reminderSchedule: true },
      });
      for (const item of settingsRows) {
        scheduleByAgency.set(
          item.agencyId,
          Array.isArray(item.reminderSchedule) && item.reminderSchedule.length
            ? item.reminderSchedule
            : [item.reminderMinutes],
        );
      }
    }
    for (const appointment of due) {
      for (const leadMinutes of scheduleByAgency.get(appointment.agencyId)) {
        const dueAt = new Date(appointment.startsAt).getTime() - Number(leadMinutes) * 60_000;
        if (dueAt > now.getTime()) continue;
        if (appointment.reminderSentAt && dueAt <= new Date(appointment.reminderSentAt).getTime()) continue;
        await sendBookingMessages({ agencyId: appointment.agencyId, appointment, kind: "reminder", dedupeSuffix: `${leadMinutes}m` }).catch((error) => {
          logger.warn("booking.reminder_failed", { appointmentId: appointment.id, leadMinutes, reason: error.message });
        });
      }
    }
    const lastAppointment = due.at(-1);
    reminderCursor = { startsAt: lastAppointment.startsAt, id: lastAppointment.id };
    if (due.length < 500) break;
  }
}

export function startBookingReminderWorker() {
  if (reminderTimer) return;
  reminderTimer = setInterval(() => {
    Promise.all([runReminderPass(), processBookingDeliveryPass(), releaseExpiredWaitlistHolds()]).catch((error) => logger.warn("booking.reminder_pass_failed", { reason: error.message }));
  }, REMINDER_POLL_MS);
  Promise.all([runReminderPass(), processBookingDeliveryPass(), releaseExpiredWaitlistHolds()]).catch((error) => logger.warn("booking.reminder_pass_failed", { reason: error.message }));
  if (reminderTimer.unref) reminderTimer.unref();
}

export function stopBookingReminderWorker() {
  if (reminderTimer) clearInterval(reminderTimer);
  reminderTimer = null;
}
