import { agencyMailConnectionStatus, createMailTransport, resolveAgencyMailConfig } from "./agencyMailService.js";
import {
  agencyMicrosoftMailboxStatus,
  personalMailboxStatus,
  sendMicrosoftMailboxEmail,
} from "./microsoftMailboxService.js";
import { agencyTwilioConnectionStatus, resolveAgencyTwilioConfig, sendAgencyTwilioSms } from "./agencyTwilioService.js";
import { twilioVoiceConnectionStatus } from "./twilioCallService.js";
import { supabaseRealtimeReady } from "./supabaseRealtimeService.js";

const enabled = (value) => Boolean(String(value || "").trim());

export async function communicationProviderStatus(agencyId, userId = null) {
  const [agencyMail, agencyMicrosoftMail, personalMail, twilio, twilioVoice] = await Promise.all([
    agencyMailConnectionStatus(agencyId),
    agencyMicrosoftMailboxStatus(agencyId),
    userId ? personalMailboxStatus(userId) : null,
    agencyTwilioConnectionStatus(agencyId),
    twilioVoiceConnectionStatus(agencyId),
  ]);
  const imapConfigured = ["IMAP_HOST", "IMAP_PORT", "IMAP_USER", "IMAP_PASSWORD"].every((key) => enabled(process.env[key]));
  return {
    Email: {
      provider: personalMail?.connected
        ? "Microsoft 365"
        : agencyMicrosoftMail?.connected
          ? "Microsoft 365"
          : agencyMail.provider || "System email",
      sendConfigured: personalMail?.connected || (!userId && agencyMail.configured),
      receiveConfigured: personalMail?.connected
        ? personalMail.syncEnabled
        : !userId && agencyMicrosoftMail?.connected
          ? agencyMicrosoftMail.inboundEnabled
          : !userId && imapConfigured,
      detail: personalMail?.connected
        ? `Connected as ${personalMail.emailAddress}`
        : userId
          ? "Connect your Microsoft mailbox in Personal Settings"
          : agencyMail.detail,
      source: personalMail?.connected ? "User" : agencyMail.source,
      secureStorageReady: agencyMail.secureStorageReady,
    },
    Sms: {
      provider: "Twilio",
      sendConfigured: twilio.Sms.configured,
      receiveConfigured: false,
      detail: twilio.Sms.detail,
      source: twilio.Sms.configured ? "Twilio" : null,
    },
    Call: {
      provider: "Twilio",
      sendConfigured: twilioVoice.configured,
      receiveConfigured: false,
      detail: twilioVoice.detail,
      source: twilioVoice.configured ? "Twilio" : null,
    },
    Chat: {
      provider: "Supabase Realtime",
      sendConfigured: supabaseRealtimeReady(),
      receiveConfigured: supabaseRealtimeReady(),
      detail: supabaseRealtimeReady() ? "Private Realtime chat connected" : "Messages are stored; add Supabase Realtime keys for live delivery",
    },
  };
}

export async function sendEmailMessage({ agencyId, userId = null, to, cc, bcc, replyTo, subject, text, html, headers, attachments, messageId }) {
  if (userId) {
    return sendMicrosoftMailboxEmail({ userId, to, cc, bcc, replyTo, subject, text, html, headers, attachments });
  }
  const config = await resolveAgencyMailConfig(agencyId);
  const result = await createMailTransport(config).sendMail({
    from: config.from,
    to,
    cc: Array.isArray(cc) && cc.length ? cc : undefined,
    bcc: Array.isArray(bcc) && bcc.length ? bcc : undefined,
    replyTo: replyTo || undefined,
    subject,
    text,
    html: html || undefined,
    headers: headers || undefined,
    attachments: Array.isArray(attachments) && attachments.length ? attachments : undefined,
    messageId: messageId || undefined,
  });
  return {
    id: result.messageId,
    provider: result.provider || "SMTP",
    response: result.response,
  };
}

export async function sendSmsMessage({ agencyId, to, body, fromNumber, idempotencyKey, requireVerified = true }) {
  const twilioConfig = await resolveAgencyTwilioConfig(agencyId, { requireVerified, sendingNumber: fromNumber });
  return sendAgencyTwilioSms({ agencyId, to, body, fromNumber, idempotencyKey, requireVerified, config: twilioConfig });
}
