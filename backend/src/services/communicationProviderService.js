import { agencyMailConnectionStatus, createMailTransport, resolveAgencyMailConfig } from "./agencyMailService.js";
import { agencyOomaConnectionStatus, sendAgencyOomaSms, startAgencyOomaCall } from "./agencyOomaService.js";
import { supabaseRealtimeReady } from "./supabaseRealtimeService.js";

const enabled = (value) => Boolean(String(value || "").trim());

export async function communicationProviderStatus(agencyId) {
  const [mail, ooma] = await Promise.all([agencyMailConnectionStatus(agencyId), agencyOomaConnectionStatus(agencyId)]);
  const imapConfigured = ["IMAP_HOST", "IMAP_PORT", "IMAP_USER", "IMAP_PASSWORD"].every((key) => enabled(process.env[key]));
  return {
    Email: {
      provider: "SMTP / IMAP",
      sendConfigured: mail.configured,
      receiveConfigured: imapConfigured,
      detail: mail.detail,
      source: mail.source,
      secureStorageReady: mail.secureStorageReady,
    },
    Sms: {
      provider: "Ooma Enterprise",
      sendConfigured: ooma.Sms.configured,
      receiveConfigured: false,
      detail: ooma.Sms.detail,
      source: ooma.Sms.source,
    },
    Call: {
      provider: "Ooma Enterprise",
      sendConfigured: ooma.Call.configured,
      receiveConfigured: false,
      detail: ooma.Call.detail,
      source: ooma.Call.source,
    },
    Chat: {
      provider: "Supabase Realtime",
      sendConfigured: supabaseRealtimeReady(),
      receiveConfigured: supabaseRealtimeReady(),
      detail: supabaseRealtimeReady() ? "Private Realtime chat connected" : "Messages are stored; add Supabase Realtime keys for live delivery",
    },
  };
}

export async function sendEmailMessage({ agencyId, to, cc, bcc, replyTo, subject, text, html, headers, attachments, messageId }) {
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
  return { id: result.messageId, provider: "SMTP" };
}

export function sendOomaSms({ agencyId, to, body, idempotencyKey }) {
  return sendAgencyOomaSms({ agencyId, to, body, idempotencyKey });
}

export function startOomaCall({ agencyId, to, idempotencyKey }) {
  return startAgencyOomaCall({ agencyId, to, idempotencyKey });
}
