import prisma from "../../services/prisma/client.js";
import { createMailTransport, resolveAgencyMailConfig } from "../../services/agencyMailService.js";
import { sendSmsMessage } from "../../services/communicationProviderService.js";
import { publicBookingPageUrl } from "../../services/bookingPublicLinkService.js";
import { logger } from "../../services/logger.js";

// Only genuinely fresh inbound inquiries — a bulk CSV import or a lead
// created because someone already booked+paid a consultation shouldn't
// get a "thanks for reaching out, let's talk" message.
const WELCOME_MESSAGE_CHANNELS = new Set([
  "WEBSITE_CONNECTOR",
  "META_LEAD_FORM",
  "GOOGLE_ADS_LEAD_FORM",
  "WHATSAPP_BUSINESS",
  "EMAIL_INTAKE",
  "PUBLIC_FORM",
]);

export function leadWelcomeEmailEligible(channel) {
  return WELCOME_MESSAGE_CHANNELS.has(channel);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

// Best-effort and fire-and-forget by design: a failed welcome message
// should never block or fail lead intake itself, so every error here is
// caught and logged, never thrown back to the caller.
export async function sendLeadWelcomeEmail(agencyId, lead, dependencies = {}) {
  if (!lead?.email && !lead?.phone) return;
  const db = dependencies.db || prisma;
  const sendSms = dependencies.sendSms || sendSmsMessage;
  const resolveMailConfig = dependencies.resolveMailConfig || resolveAgencyMailConfig;
  const makeMailTransport = dependencies.makeMailTransport || createMailTransport;
  const channel = lead.email ? "email" : "sms";
  const recipient = lead.email || lead.phone;
  const dedupeKey = `lead-welcome:${lead.id}`;
  let delivery = null;
  try {
    const [leadSettings, agency, bookingSettings] = await Promise.all([
      db.leadSettings.findUnique({ where: { agencyId } }),
      db.agency.findUnique({ where: { id: agencyId }, select: { name: true, legalName: true, phone: true, email: true } }),
      db.bookingSettings.findUnique({ where: { agencyId } }),
    ]);

    const agencyName = agency?.legalName || agency?.name || "our team";
    const firstName = lead.firstName || "there";
    const bookingUrl = bookingSettings ? publicBookingPageUrl(bookingSettings) : null;
    const subject = channel === "email" ? `Thanks for reaching out to ${agencyName}` : null;
    const smsBody = bookingUrl
      ? `${agencyName}: Hi ${firstName}, thanks for reaching out — we've read what you shared and would love to help. Book a time here: ${bookingUrl}`
      : null;
    const text = bookingUrl ? [
      `Hi ${firstName},`,
      "",
      `Thanks for getting in touch with ${agencyName} — we've read through what you shared, and we'd be happy to go over it with you in more detail.`,
      "",
      `The easiest next step is to grab a time that works for you here: ${bookingUrl}`,
      "",
      "Talk soon,",
      agencyName,
    ].join("\n") : null;

    delivery = await db.leadMessageDelivery.upsert({
      where: { agencyId_dedupeKey: { agencyId, dedupeKey } },
      create: {
        agencyId,
        leadId: lead.id,
        kind: "welcome",
        channel,
        recipient,
        status: "pending",
        dedupeKey,
        subject,
        body: channel === "sms" ? smsBody : text,
        sourceChannel: lead.sourceChannel || null,
        payload: { automated: true },
      },
      update: {},
    });

    // Intake events are idempotent. Never send the same welcome twice if a
    // worker is restarted or an already-processed event is encountered again.
    if (delivery.status !== "pending") return delivery;

    if (leadSettings?.welcomeEmailEnabled === false || !bookingSettings) {
      const reason = leadSettings?.welcomeEmailEnabled === false
        ? "Automatic welcome messages are turned off in Lead Settings."
        : "Public booking settings are unavailable, so a booking link could not be generated.";
      return db.leadMessageDelivery.update({
        where: { id: delivery.id },
        data: { status: "skipped", lastError: reason },
      });
    }

    const claimed = await db.leadMessageDelivery.updateMany({
      where: { id: delivery.id, status: "pending" },
      data: { status: "sending", attempts: { increment: 1 }, lastError: null },
    });
    if (!claimed.count) return delivery;

    // No email on file — fall back to a text through the agency's Twilio
    // line rather than sending the lead nothing at all.
    if (!lead.email) {
      const result = await sendSms({ agencyId, to: lead.phone, body: smsBody, idempotencyKey: dedupeKey });
      const sent = await db.leadMessageDelivery.update({
        where: { id: delivery.id },
        data: {
          status: "sent",
          sentAt: new Date(),
          failedAt: null,
          provider: result?.provider || "Twilio",
          providerId: result?.id ? String(result.id) : null,
          lastError: null,
        },
      });
      logger.info("lead.welcome_sms_sent", { agencyId, leadId: lead.id });
      return sent;
    }

    const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f1f5f9"><tr><td align="center" style="padding:38px 14px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px;background:#ffffff;border:1px solid #e2e8f0;border-radius:24px;overflow:hidden">
      <tr><td style="padding:34px 34px 10px">
        <h1 style="margin:0;color:#0f172a;font-size:24px;line-height:1.3;letter-spacing:-.02em;font-weight:750">Thanks for reaching out, ${escapeHtml(firstName)}</h1>
        <p style="margin:14px 0 0;color:#475569;font-size:15px;line-height:1.65">We've read through what you shared with ${escapeHtml(agencyName)}, and we'd be happy to go over it with you in more detail.</p>
        <p style="margin:14px 0 0;color:#475569;font-size:15px;line-height:1.65">The easiest next step is to grab a time that works for you — no back-and-forth needed.</p>
      </td></tr>
      <tr><td style="padding:20px 34px 34px">
        <a href="${escapeHtml(bookingUrl)}" style="display:inline-block;border-radius:999px;background:#0f172a;color:#ffffff;text-decoration:none;padding:14px 24px;font-size:14px;font-weight:750">Book a time to talk &nbsp;→</a>
      </td></tr>
      <tr><td style="padding:20px 34px;background:#f8fafc;border-top:1px solid #e2e8f0"><p style="margin:0;color:#334155;font-size:13px;font-weight:700">${escapeHtml(agencyName)}</p>${agency?.phone || agency?.email ? `<p style="margin:6px 0 0;color:#64748b;font-size:12px;line-height:1.5">${escapeHtml([agency?.phone, agency?.email].filter(Boolean).join(" · "))}</p>` : ""}</td></tr>
    </table>
  </td></tr></table>
</body></html>`;

    const config = await resolveMailConfig(agencyId);
    const transport = makeMailTransport(config);
    const result = await transport.sendMail({ from: config.from, to: lead.email, subject, text, html });
    const sent = await db.leadMessageDelivery.update({
      where: { id: delivery.id },
      data: {
        status: "sent",
        sentAt: new Date(),
        failedAt: null,
        provider: "Agency email",
        providerId: result?.messageId ? String(result.messageId) : null,
        lastError: null,
      },
    });
    logger.info("lead.welcome_email_sent", { agencyId, leadId: lead.id });
    return sent;
  } catch (error) {
    if (delivery?.id) {
      await db.leadMessageDelivery.update({
        where: { id: delivery.id },
        data: {
          status: "failed",
          failedAt: new Date(),
          lastError: String(error?.message || "Welcome message delivery failed").slice(0, 1000),
        },
      }).catch(() => {});
    }
    logger.warn("lead.welcome_message_failed", { agencyId, leadId: lead.id, reason: error.message });
    return null;
  }
}
