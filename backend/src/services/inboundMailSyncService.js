import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import prisma from "./prisma/client.js";
import { resolveAgencyImapConfig } from "./agencyMailService.js";
import { ingestInboundCommunication } from "../controllers/communicationWebhookController.js";
import { storeInboundCommunicationAttachments } from "../controllers/communicationAttachmentController.js";
import { enqueueTrustedProviderLead } from "../modules/leads/lead.website.service.js";
import { adminRecipientIds, notifyUsers } from "./notificationService.js";
import {
  agencyMicrosoftGraphClient,
  microsoftGraphClient,
} from "./microsoftMailboxService.js";

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

const graphAddresses = (values) =>
  Array.isArray(values)
    ? values.map((item) => item?.emailAddress?.address).filter(Boolean)
    : [];

const graphHeader = (message, name) =>
  message.internetMessageHeaders?.find(
    (item) => String(item.name).toLowerCase() === name.toLowerCase(),
  )?.value || null;

async function syncPersonalMicrosoftMailbox(connection) {
  const startedAt = new Date();
  try {
    const { request } = await microsoftGraphClient(connection.userId);
    const since = new Date(
      Math.max(
        (connection.lastSyncedAt || connection.connectedAt || startedAt).getTime() - 5 * 60_000,
        startedAt.getTime() - 7 * 24 * 60 * 60_000,
      ),
    ).toISOString();
    const query = new URLSearchParams({
      "$filter": `receivedDateTime ge ${since}`,
      "$orderby": "receivedDateTime asc",
      "$top": "50",
      "$select": "id,internetMessageId,conversationId,receivedDateTime,subject,body,bodyPreview,from,toRecipients,ccRecipients,internetMessageHeaders,hasAttachments",
    });
    let next = `/me/mailFolders/inbox/messages?${query}`;
    let pages = 0;
    let imported = 0;
    while (next && pages < 5) {
      const result = await request(next);
      for (const message of result.value || []) {
        const senderAddress = message.from?.emailAddress?.address?.toLowerCase() || null;
        if (!senderAddress) continue;
        const inReplyTo = graphHeader(message, "in-reply-to");
        const knownClient = await prisma.client.findFirst({
          where: { agencyId: connection.agencyId, email: { equals: senderAddress, mode: "insensitive" } },
          select: { id: true },
        });
        const knownThread = inReplyTo
          ? await prisma.communicationMessage.findFirst({
              where: { agencyId: connection.agencyId, emailMessageId: inReplyTo },
              select: { id: true },
            })
          : null;
        // Personal inbox privacy: only CRM-related mail is imported. Unrelated
        // personal messages never enter the agency-wide unmatched queue.
        if (!knownClient && !knownThread) continue;
        const recipients = [
          ...graphAddresses(message.toRecipients),
          ...graphAddresses(message.ccRecipients),
        ];
        const references = String(graphHeader(message, "references") || "")
          .split(/\s+/)
          .filter(Boolean);
        const ingested = await ingestInboundCommunication({
          agencyId: connection.agencyId,
          channel: "Email",
          provider: "Microsoft 365",
          providerMessageId: message.id,
          providerThreadId: message.conversationId || null,
          providerEventId: `microsoft:${connection.id}:${message.id}`,
          senderAddress,
          recipients,
          subject: message.subject || null,
          bodyText: message.body?.contentType === "text" ? message.body.content : message.bodyPreview || null,
          bodyHtml: message.body?.contentType?.toLowerCase() === "html" ? message.body.content : null,
          emailMessageId: message.internetMessageId || null,
          emailInReplyTo: inReplyTo,
          emailReferences: references,
          occurredAt: message.receivedDateTime || new Date(),
          metadata: {
            microsoftMessageId: message.id,
            mailboxOwnerUserId: connection.userId,
            hasAttachments: message.hasAttachments === true,
          },
        });
        if (!ingested.duplicate) imported += 1;
      }
      next = result["@odata.nextLink"] || null;
      pages += 1;
    }
    await prisma.userMailboxConnection.update({
      where: { id: connection.id },
      data: {
        lastSyncedAt: startedAt,
        lastSyncStatus: "Connected",
        lastSyncMessage: imported
          ? `${imported} matching client email${imported === 1 ? "" : "s"} synchronized.`
          : "Mailbox checked; no new matching client email.",
        lastError: null,
      },
    });
  } catch (error) {
    const message = String(error.message || "Microsoft mailbox synchronization failed.").slice(0, 500);
    await prisma.userMailboxConnection.update({
      where: { id: connection.id },
      data: { lastSyncedAt: startedAt, lastSyncStatus: "Failed", lastSyncMessage: message, lastError: message },
    }).catch(() => {});
    await notifyUsers({
      agencyId: connection.agencyId,
      recipientIds: [connection.userId],
      type: "settings.personal_mail_sync_failed",
      category: "security",
      title: "Your Microsoft mailbox needs attention",
      body: message,
      severity: "warning",
      entityType: "user_mailbox_connection",
      entityId: connection.id,
      actionUrl: "/app/settings?section=personal-email",
      channels: ["in_app"],
      dedupeKey: `personal-mail-sync:${connection.id}:${new Date().toISOString().slice(0, 10)}`,
    }).catch(() => {});
  }
}

async function syncAgencyMicrosoftMailbox(connection) {
  const startedAt = new Date();
  try {
    const { request } = await agencyMicrosoftGraphClient(connection.agencyId);
    const since = new Date(
      Math.max(
        (connection.lastSyncedAt || connection.connectedAt || startedAt).getTime() - 5 * 60_000,
        startedAt.getTime() - 7 * 24 * 60 * 60_000,
      ),
    ).toISOString();
    const query = new URLSearchParams({
      "$filter": `receivedDateTime ge ${since}`,
      "$orderby": "receivedDateTime asc",
      "$top": "50",
      "$select": "id,internetMessageId,conversationId,receivedDateTime,subject,body,bodyPreview,from,toRecipients,ccRecipients,internetMessageHeaders,hasAttachments",
    });
    let next = `/me/mailFolders/inbox/messages?${query}`;
    let pages = 0;
    let imported = 0;
    while (next && pages < 5) {
      const result = await request(next);
      for (const message of result.value || []) {
        const senderAddress = message.from?.emailAddress?.address?.toLowerCase() || null;
        if (!senderAddress) continue;
        const recipients = [
          ...graphAddresses(message.toRecipients),
          ...graphAddresses(message.ccRecipients),
        ];
        const inReplyTo = graphHeader(message, "in-reply-to");
        const references = String(graphHeader(message, "references") || "")
          .split(/\s+/)
          .filter(Boolean);
        const attachments = [];
        if (message.hasAttachments) {
          const attachmentResult = await request(
            `/me/messages/${encodeURIComponent(message.id)}/attachments?$select=id,name,contentType,size,contentBytes`,
          );
          for (const attachment of attachmentResult.value || []) {
            if (attachment["@odata.type"] !== "#microsoft.graph.fileAttachment" || !attachment.contentBytes) continue;
            attachments.push({
              filename: attachment.name || "attachment",
              contentType: attachment.contentType || "application/octet-stream",
              size: attachment.size || 0,
              content: Buffer.from(attachment.contentBytes, "base64"),
            });
          }
        }
        const ingested = await ingestInboundCommunication({
          agencyId: connection.agencyId,
          channel: "Email",
          provider: "Microsoft 365",
          providerMessageId: message.id,
          providerThreadId: message.conversationId || null,
          providerEventId: `microsoft-system:${connection.id}:${message.id}`,
          senderAddress,
          recipients,
          subject: message.subject || null,
          bodyText: message.body?.contentType?.toLowerCase() === "text"
            ? message.body.content
            : message.bodyPreview || null,
          bodyHtml: message.body?.contentType?.toLowerCase() === "html"
            ? message.body.content
            : null,
          emailMessageId: message.internetMessageId || null,
          emailInReplyTo: inReplyTo,
          emailReferences: references,
          occurredAt: message.receivedDateTime || new Date(),
          metadata: {
            microsoftMessageId: message.id,
            systemMailbox: connection.emailAddress,
            hasAttachments: message.hasAttachments === true,
            attachments: attachments.map((attachment) => ({
              filename: attachment.filename,
              contentType: attachment.contentType,
              size: attachment.size,
            })),
          },
        });
        if (ingested.unmatched) {
          await enqueueTrustedProviderLead({
            agencyId: connection.agencyId,
            provider: "EMAIL",
            eventId: message.internetMessageId || `microsoft-system:${connection.id}:${message.id}`,
            payload: {
              from: senderAddress,
              recipients,
              subject: message.subject || null,
              bodyText: message.bodyPreview || null,
              messageId: message.internetMessageId || message.id,
              occurredAt: message.receivedDateTime || new Date(),
            },
          });
        }
        if (!ingested.unmatched && !ingested.duplicate && attachments.length) {
          await storeInboundCommunicationAttachments({
            agencyId: connection.agencyId,
            messageId: ingested.data.id,
            attachments,
          });
        }
        if (!ingested.duplicate) imported += 1;
      }
      next = result["@odata.nextLink"] || null;
      pages += 1;
    }
    await prisma.agencyMicrosoftMailboxConnection.update({
      where: { id: connection.id },
      data: {
        lastSyncedAt: startedAt,
        lastSyncStatus: "Connected",
        lastSyncMessage: imported
          ? `${imported} system mailbox email${imported === 1 ? "" : "s"} synchronized.`
          : "Mailbox checked; no new email.",
        lastError: null,
      },
    });
  } catch (error) {
    const message = String(error.message || "System Microsoft mailbox synchronization failed.").slice(0, 500);
    await prisma.agencyMicrosoftMailboxConnection.update({
      where: { id: connection.id },
      data: {
        lastSyncedAt: startedAt,
        lastSyncStatus: "Failed",
        lastSyncMessage: message,
        lastError: message,
      },
    }).catch(() => {});
    await notifyUsers({
      agencyId: connection.agencyId,
      recipientIds: await adminRecipientIds(connection.agencyId),
      type: "settings.system_mail_sync_failed",
      category: "security",
      title: "System Microsoft mailbox needs attention",
      body: message,
      severity: "warning",
      entityType: "agency_microsoft_mailbox_connection",
      entityId: connection.id,
      actionUrl: "/app/settings?section=agency-email",
      channels: ["in_app"],
      dedupeKey: `system-mail-sync:${connection.id}:${new Date().toISOString().slice(0, 10)}`,
    }).catch(() => {});
  }
}

export async function syncInboundMail() {
  if (running) return;
  running = true;
  try {
    const [settings, systemMicrosoftMailboxes, personalMailboxes] = await Promise.all([
      prisma.agencyMailSettings.findMany({
        where: { enabled: true, inboundEnabled: true, lastTestStatus: "Connected" },
      }),
      prisma.agencyMicrosoftMailboxConnection.findMany({
        where: {
          status: "connected",
          enabled: true,
          inboundEnabled: true,
        },
      }),
      prisma.userMailboxConnection.findMany({
        where: { status: "connected", syncEnabled: true },
      }),
    ]);
    for (const mailbox of settings) await syncAgencyMailbox(mailbox);
    for (const mailbox of systemMicrosoftMailboxes) await syncAgencyMicrosoftMailbox(mailbox);
    for (const mailbox of personalMailboxes) await syncPersonalMicrosoftMailbox(mailbox);
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
