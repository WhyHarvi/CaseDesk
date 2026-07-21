import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import prisma from "./prisma/client.js";
import { resolveAgencyImapConfig } from "./agencyMailService.js";
import { ingestInboundCommunication } from "../controllers/communicationWebhookController.js";
import { storeInboundCommunicationAttachments } from "../controllers/communicationAttachmentController.js";
import { enqueueTrustedProviderLead } from "../modules/leads/lead.website.service.js";
import { adminRecipientIds, notifyUsers } from "./notificationService.js";

const SYNC_INTERVAL_MS = Math.max(
  Number(process.env.INBOUND_MAIL_SYNC_MS) || 60000,
  15000,
);
const INITIAL_IMPORT_LIMIT = Math.min(
  Math.max(Number(process.env.INBOUND_MAIL_INITIAL_LIMIT) || 100, 1),
  500,
);
let timer = null;
let running = false;

const addresses = (field) =>
  Array.isArray(field?.value)
    ? field.value.map((item) => item.address).filter(Boolean)
    : [];

async function updateSyncStatus(agencyId, values) {
  await prisma.agencyMailSettings
    .update({ where: { agencyId }, data: values })
    .catch(() => {});
}

async function syncAgencyMailbox(settings) {
  const config = await resolveAgencyImapConfig(settings.agencyId, {
    requireVerified: true,
  });
  const client = new ImapFlow({
    host: config.imapHost,
    port: config.imapPort,
    secure: config.imapSecure,
    auth: { user: config.imapUsername, pass: config.imapPassword },
    logger: false,
    socketTimeout: 45000,
  });
  // ImapFlow can emit an async 'error' event during internal cleanup (e.g.
  // after a failed auth) in addition to rejecting connect() — with no
  // listener, that event is an uncaught exception that crashes the process.
  client.on("error", () => {});
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const allUids = await client.search({ all: true }, { uid: true });
      const previousUid =
        settings.lastSyncedUid == null ? null : Number(settings.lastSyncedUid);
      const candidates =
        previousUid == null
          ? allUids.slice(-INITIAL_IMPORT_LIMIT)
          : allUids.filter((uid) => uid > previousUid);
      for (const uid of candidates) {
        for await (const item of client.fetch(
          uid,
          { uid: true, source: true },
          { uid: true },
        )) {
          if (!item.source) continue;
          const parsed = await simpleParser(item.source, {
            skipImageLinks: true,
            skipHtmlToText: false,
          });
          const senderAddress =
            addresses(parsed.from)[0] || parsed.from?.text || null;
          const recipients = [...addresses(parsed.to), ...addresses(parsed.cc)];
          const result = await ingestInboundCommunication({
            agencyId: settings.agencyId,
            channel: "Email",
            provider: settings.provider || "IMAP",
            providerMessageId:
              parsed.messageId || `imap:${settings.agencyId}:${uid}`,
            providerThreadId:
              parsed.references?.[0] || parsed.inReplyTo || null,
            providerEventId: `imap:${settings.agencyId}:${uid}`,
            senderAddress,
            recipients,
            subject: parsed.subject || null,
            bodyText: parsed.text || null,
            bodyHtml: typeof parsed.html === "string" ? parsed.html : null,
            emailMessageId: parsed.messageId || null,
            emailInReplyTo: parsed.inReplyTo || null,
            emailReferences: Array.isArray(parsed.references)
              ? parsed.references
              : parsed.references
                ? [parsed.references]
                : [],
            occurredAt: parsed.date || new Date(),
            metadata: {
              imapUid: uid,
              attachments: parsed.attachments.map((attachment) => ({
                filename: attachment.filename,
                contentType: attachment.contentType,
                size: attachment.size,
                checksum: attachment.checksum,
              })),
            },
          });
          if (result.unmatched) {
            await enqueueTrustedProviderLead({
              agencyId: settings.agencyId,
              provider: "EMAIL",
              eventId: parsed.messageId || `imap:${settings.agencyId}:${uid}`,
              payload: { from: senderAddress, recipients, subject: parsed.subject || null, bodyText: parsed.text || null, messageId: parsed.messageId || `imap:${settings.agencyId}:${uid}`, occurredAt: parsed.date || new Date() },
            });
          }
          if (
            !result.unmatched &&
            !result.duplicate &&
            parsed.attachments.length
          ) {
            await storeInboundCommunicationAttachments({
              agencyId: settings.agencyId,
              messageId: result.data.id,
              attachments: parsed.attachments,
            });
          }
          await updateSyncStatus(settings.agencyId, {
            lastSyncedUid: BigInt(uid),
            lastInboundSyncAt: new Date(),
            lastInboundSyncStatus: "Connected",
            lastInboundSyncMessage:
              "Incoming mailbox synchronized successfully.",
          });
        }
      }
      if (!candidates.length)
        await updateSyncStatus(settings.agencyId, {
          lastInboundSyncAt: new Date(),
          lastInboundSyncStatus: "Connected",
          lastInboundSyncMessage: "Mailbox checked; no new messages.",
        });
    } finally {
      lock.release();
    }
  } catch (error) {
    const message = String(
      error.message || "Incoming mailbox synchronization failed",
    ).slice(0, 500);
    await updateSyncStatus(settings.agencyId, {
      lastInboundSyncAt: new Date(),
      lastInboundSyncStatus: "Failed",
      lastInboundSyncMessage: message,
    });
    await notifyUsers({
      agencyId: settings.agencyId,
      recipientIds: await adminRecipientIds(settings.agencyId),
      type: "settings.inbound_mail_sync_failed",
      category: "security",
      title: "Incoming mailbox synchronization failed",
      body: message,
      severity: "warning",
      entityType: "agency_mail_settings",
      entityId: settings.id,
      actionUrl: "/app/settings",
      channels: ["in_app"],
      dedupeKey: `inbound-mail-sync:${settings.id}:${new Date().toISOString().slice(0, 10)}`,
    }).catch(() => {});
  } finally {
    await client.logout().catch(() => {});
  }
}

export async function syncInboundMail() {
  if (running) return;
  running = true;
  try {
    const settings = await prisma.agencyMailSettings.findMany({
      where: {
        enabled: true,
        inboundEnabled: true,
        lastTestStatus: "Connected",
      },
    });
    for (const mailbox of settings) await syncAgencyMailbox(mailbox);
  } catch (error) {
    if (process.env.NODE_ENV !== "test")
      console.error("Inbound mail synchronization failed", error);
  } finally {
    running = false;
  }
}

export function startInboundMailSync() {
  if (timer || process.env.NODE_ENV === "test") return;
  void syncInboundMail();
  timer = setInterval(() => void syncInboundMail(), SYNC_INTERVAL_MS);
  timer.unref?.();
}

export function stopInboundMailSync() {
  if (timer) clearInterval(timer);
  timer = null;
}
