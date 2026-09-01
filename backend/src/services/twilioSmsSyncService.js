import twilio from "twilio";
import prisma from "./prisma/client.js";
import { decryptSecret } from "./secretEncryption.js";
import { normalizeCommunicationPhone } from "./communicationAddressService.js";

const HISTORY_DAYS = 120;
const HISTORY_LIMIT = 500;

function messageStatus(message, inbound) {
  if (inbound) return "Received";
  if (message.status === "delivered") return "Delivered";
  if (["failed", "undelivered"].includes(message.status)) return "Failed";
  return "Sent";
}

function occurredAt(message) {
  const value = message.dateSent || message.dateCreated || new Date();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export async function syncAgencyTwilioSmsHistory(agencyId, { publicBase = null } = {}) {
  const settings = await prisma.agencyTwilioSettings.findUnique({ where: { agencyId } });
  if (!settings?.accountSid || !settings?.authTokenEncrypted || !settings.enabled || !settings.smsEnabled) {
    return { imported: 0, matched: 0, examined: 0, webhookConfigured: 0, skipped: true };
  }

  const lines = await prisma.agencyTwilioVoiceLine.findMany({
    where: { agencyId, enabled: true },
    select: { id: true, numberSid: true, phoneNumber: true },
  });
  const agencyNumbers = new Set(
    [...lines.map((line) => line.phoneNumber), settings.voiceNumber, settings.fromNumber]
      .map(normalizeCommunicationPhone)
      .filter(Boolean),
  );
  if (!agencyNumbers.size) return { imported: 0, matched: 0, examined: 0, webhookConfigured: 0, skipped: true };

  const client = twilio(settings.accountSid, decryptSecret(settings.authTokenEncrypted));
  let webhookConfigured = 0;
  if (publicBase) {
    const smsUrl = `${String(publicBase).replace(/\/+$/, "")}/api/communications/webhooks/twilio/sms/${agencyId}`;
    const results = await Promise.allSettled(lines.map((line) => client.incomingPhoneNumbers(line.numberSid).update({ smsMethod: "POST", smsUrl })));
    webhookConfigured = results.filter((result) => result.status === "fulfilled").length;
  }

  const remoteClients = await prisma.client.findMany({
    where: { agencyId, phone: { not: null } },
    select: { id: true, phone: true, phoneNormalized: true, assignedUserId: true },
  });
  const clientsByPhone = new Map();
  remoteClients.forEach((item) => {
    const phone = normalizeCommunicationPhone(item.phoneNormalized || item.phone);
    if (phone && !clientsByPhone.has(phone)) clientsByPhone.set(phone, item);
  });
  const owner = await prisma.user.findFirst({
    where: { agencyId, status: "active" },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  if (!owner) return { imported: 0, matched: 0, examined: 0, webhookConfigured, skipped: true };

  const messages = await client.messages.list({
    dateSentAfter: new Date(Date.now() - HISTORY_DAYS * 24 * 60 * 60_000),
    limit: HISTORY_LIMIT,
  });
  let imported = 0;
  let matched = 0;
  const chronological = [...messages].sort((a, b) => occurredAt(a) - occurredAt(b));
  for (const providerMessage of chronological) {
    if ([providerMessage.from, providerMessage.to].some((value) => String(value || "").toLowerCase().startsWith("whatsapp:"))) continue;
    const from = normalizeCommunicationPhone(providerMessage.from);
    const to = normalizeCommunicationPhone(providerMessage.to);
    const inbound = String(providerMessage.direction || "").startsWith("inbound");
    const localNumber = inbound ? to : from;
    const remoteNumber = inbound ? from : to;
    if (!agencyNumbers.has(localNumber) || !remoteNumber) continue;
    const linkedClient = clientsByPhone.get(remoteNumber);
    if (!linkedClient) continue;
    matched += 1;
    const timestamp = occurredAt(providerMessage);
    const status = messageStatus(providerMessage, inbound);
    const created = await prisma.$transaction(async (tx) => {
      const duplicate = await tx.communicationMessage.findFirst({
        where: { agencyId, provider: "Twilio", providerMessageId: providerMessage.sid },
        select: { id: true },
      });
      if (duplicate) return false;
      const caseItem = await tx.case.findFirst({
        where: { agencyId, clientId: linkedClient.id, deletedAt: null },
        orderBy: { updatedAt: "desc" },
        select: { id: true, assignedUserId: true },
      });
      let conversation = await tx.communicationConversation.findFirst({
        where: { agencyId, clientId: linkedClient.id, channel: "Sms", state: { not: "Closed" }, deletedAt: null },
        orderBy: { lastMessageAt: "desc" },
      });
      if (!conversation) {
        conversation = await tx.communicationConversation.create({
          data: {
            agencyId,
            clientId: linkedClient.id,
            caseId: caseItem?.id || null,
            channel: "Sms",
            provider: "Twilio",
            assignedToId: caseItem?.assignedUserId || linkedClient.assignedUserId || owner.id,
            createdById: owner.id,
            state: inbound ? "WaitingOnAgency" : "WaitingOnClient",
            lastMessageAt: timestamp,
            firstInboundAt: inbound ? timestamp : null,
            lastInboundAt: inbound ? timestamp : null,
            lastOutboundAt: inbound ? null : timestamp,
          },
        });
      }
      await tx.communicationMessage.create({
        data: {
          agencyId,
          clientId: linkedClient.id,
          caseId: conversation.caseId,
          conversationId: conversation.id,
          channel: "Sms",
          direction: inbound ? "Inbound" : "Outbound",
          status,
          senderAddress: providerMessage.from || null,
          recipients: providerMessage.to ? [providerMessage.to] : [],
          bodyText: providerMessage.body || null,
          provider: "Twilio",
          providerMessageId: providerMessage.sid,
          occurredAt: timestamp,
          sentAt: inbound ? null : timestamp,
          deliveredAt: status === "Delivered" ? timestamp : null,
          failedAt: status === "Failed" ? timestamp : null,
          failureReason: providerMessage.errorMessage || null,
          metadata: { importedFromTwilio: true, twilioDirection: providerMessage.direction || null },
          isRead: true,
        },
      });
      const newest = timestamp >= conversation.lastMessageAt;
      if (newest) {
        await tx.communicationConversation.update({
          where: { id: conversation.id },
          data: {
            state: inbound ? "WaitingOnAgency" : "WaitingOnClient",
            lastMessageAt: timestamp,
            ...(inbound
              ? { firstInboundAt: conversation.firstInboundAt || timestamp, lastInboundAt: timestamp }
              : { lastOutboundAt: timestamp }),
          },
        });
      }
      return true;
    });
    if (created) imported += 1;
  }
  return { imported, matched, examined: messages.length, webhookConfigured, skipped: false };
}
