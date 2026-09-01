import { timingSafeEqual } from "node:crypto";
import prisma from "../services/prisma/client.js";
import { recordCommunicationAudit } from "../services/communicationAudit.js";
import { applyCommunicationAutomations } from "../services/communicationAutomationService.js";
import {
  communicationResolutionDueAt,
  communicationResponseDueAt,
} from "../services/communicationSlaService.js";
import { createHttpError } from "../utils/http.js";
import { normalizeCommunicationPhone } from "../services/communicationAddressService.js";
import { linkOne } from "../services/uciCommunicationMatchingService.js";
import { logger } from "../services/logger.js";

const channels = new Set(["Email", "Sms", "Chat", "Call"]);
const stopWords = new Set(["stop", "unsubscribe", "cancel", "end", "quit"]);

const clean = (value, max = 500) =>
  String(value ?? "")
    .trim()
    .slice(0, max);
const array = (value, limit = 50) =>
  Array.isArray(value) ? value.slice(0, limit) : [];
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
const date = (value) => {
  const parsed = value ? new Date(value) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};
const normalizePhone = (value) =>
  normalizeCommunicationPhone(value) ||
  clean(value, 80).replace(/[^+\d]/g, "");
const httpsUrl = (value) => {
  try {
    const parsed = new URL(clean(value, 2000));
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
};

function verifySecret(req) {
  const expected = clean(process.env.COMMUNICATION_WEBHOOK_SECRET, 500);
  if (!expected)
    throw createHttpError(
      503,
      "Communication webhook secret is not configured",
    );
  const supplied = clean(req.header("x-casedesk-webhook-secret"), 500);
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  if (
    expectedBuffer.length !== suppliedBuffer.length ||
    !timingSafeEqual(expectedBuffer, suppliedBuffer)
  ) {
    throw createHttpError(401, "Invalid communication webhook signature");
  }
}

async function agencyContext(agencyId) {
  const agency = await prisma.agency.findUnique({ where: { id: agencyId } });
  if (!agency) throw createHttpError(404, "Agency not found");
  const user = await prisma.user.findFirst({
    where: { agencyId },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
  });
  if (!user)
    throw createHttpError(
      409,
      "Agency has no user available to own inbound communication",
    );
  return { agency, user };
}

async function findClient(agencyId, channel, senderAddress) {
  if (!senderAddress) return null;
  if (channel === "Email") {
    const normalizedEmail = clean(senderAddress, 320).toLowerCase();
    return prisma.client.findFirst({
      where: {
        agencyId,
        OR: [
          { emailNormalized: normalizedEmail },
          { email: { equals: senderAddress, mode: "insensitive" } },
        ],
      },
    });
  }
  const normalized = normalizeCommunicationPhone(senderAddress);
  if (!normalized) return null;
  const direct = await prisma.client.findFirst({
    where: {
      agencyId,
      OR: [
        { phoneNormalized: normalized },
        { phone: { equals: senderAddress, mode: "insensitive" } },
      ],
    },
  });
  if (direct) return direct;

  // Support older client rows created before canonical phone storage was added.
  const legacyCandidates = await prisma.client.findMany({
    where: { agencyId, phoneNormalized: null, phone: { not: null } },
  });
  return legacyCandidates.find(
    (client) => normalizeCommunicationPhone(client.phone) === normalized,
  ) || null;
}

async function storeUnmatched({
  agencyId,
  channel,
  provider,
  providerMessageId,
  senderAddress,
  recipients,
  subject,
  bodyText,
  occurredAt,
  rawPayload,
}) {
  if (providerMessageId) {
    const existing = await prisma.unmatchedCommunication.findFirst({
      where: { agencyId, provider, providerMessageId },
    });
    if (existing) return { data: existing, unmatched: true, duplicate: true };
  }
  const data = await prisma.unmatchedCommunication.create({
    data: {
      agencyId,
      channel,
      provider,
      providerMessageId,
      senderAddress,
      recipients,
      subject,
      bodyText,
      occurredAt,
      rawPayload,
    },
  });
  await recordCommunicationAudit({
    agencyId,
    action: "communication.inbound_unmatched",
    details: `${channel} received from ${senderAddress || "unknown sender"}`,
    metadata: { unmatchedId: data.id, provider, providerMessageId },
  });
  // Attempt an immediate UCI match right away instead of waiting for the
  // next hourly reconciliation pass — most genuinely new messages that can
  // be matched at all can be matched the moment they arrive. This does not
  // change this function's own return value (still `unmatched: true`) since
  // callers key other side effects (e.g. lead-intake enqueueing) off of
  // "landed unmatched", exactly as an hourly-worker match would have left
  // it before this row existed.
  if (channel === "Email") {
    await linkOne(data).catch((error) => {
      logger.warn("uci_match.ingest_check_failed", { unmatchedId: data.id, reason: error.message });
    });
  }
  return { data, unmatched: true, duplicate: false };
}

async function recordOptOut({
  agencyId,
  clientId,
  channel,
  senderAddress,
  payload,
  occurredAt,
}) {
  if (!["Sms", "Email"].includes(channel) || !senderAddress) return;
  const address =
    channel === "Sms"
      ? normalizePhone(senderAddress)
      : senderAddress.toLowerCase();
  await prisma.communicationConsent.upsert({
    where: { agencyId_channel_address: { agencyId, channel, address } },
    create: {
      agencyId,
      clientId,
      channel,
      address,
      status: "OptedOut",
      source: "Inbound provider message",
      purpose: "Client communication",
      proof: payload,
      optedOutAt: occurredAt,
    },
    update: {
      clientId,
      status: "OptedOut",
      source: "Inbound provider message",
      proof: payload,
      optedOutAt: occurredAt,
    },
  });
}

export async function ingestInboundCommunication(payload) {
  const agencyId = clean(payload.agencyId, 80);
  const channel = channels.has(payload.channel) ? payload.channel : null;
  const provider = clean(payload.provider, 80, "Webhook") || "Webhook";
  const providerMessageId =
    clean(
      payload.providerMessageId || payload.messageId || payload.callId,
      300,
    ) || null;
  const senderAddress =
    clean(payload.senderAddress || payload.from, 320) || null;
  const recipients = array(
    payload.recipients || (payload.to ? [payload.to] : []),
  )
    .map((item) => clean(item, 320))
    .filter(Boolean);
  const subject = clean(payload.subject, 300) || null;
  const bodyText =
    clean(payload.bodyText || payload.body || payload.text, 20000) || null;
  const occurredAt = date(payload.occurredAt || payload.timestamp);
  if (!agencyId || !channel)
    throw createHttpError(
      400,
      "agencyId and a valid communication channel are required",
    );
  const { user } = await agencyContext(agencyId);

  if (providerMessageId) {
    const duplicate = await prisma.communicationMessage.findFirst({
      where: { agencyId, provider, providerMessageId },
    });
    if (duplicate)
      return { data: duplicate, duplicate: true, unmatched: false };
  }

  const client = await findClient(agencyId, channel, senderAddress);
  if (!client)
    return storeUnmatched({
      agencyId,
      channel,
      provider,
      providerMessageId,
      senderAddress,
      recipients,
      subject,
      bodyText,
      occurredAt,
      rawPayload: payload,
    });
  const caseItem =
    (await prisma.case.findFirst({
      where: { agencyId, clientId: client.id, status: { not: "Closed" } },
      orderBy: { updatedAt: "desc" },
    })) ||
    (await prisma.case.findFirst({
      where: { agencyId, clientId: client.id },
      orderBy: { updatedAt: "desc" },
    }));
  // Email and SMS belong to the client record even when that client does not
  // have a case yet. Call records retain their existing case requirement.
  if (!caseItem && !["Email", "Sms"].includes(channel))
    return storeUnmatched({
      agencyId,
      channel,
      provider,
      providerMessageId,
      senderAddress,
      recipients,
      subject,
      bodyText,
      occurredAt,
      rawPayload: payload,
    });
  const responseDueAt = await communicationResponseDueAt(agencyId, occurredAt);
  const resolutionDueAt = await communicationResolutionDueAt(
    agencyId,
    occurredAt,
  );

  const providerThreadId =
    clean(payload.providerThreadId || payload.threadId, 300) || null;
  const emailInReplyTo =
    clean(payload.emailInReplyTo || payload.headers?.["in-reply-to"], 500) ||
    null;
  const messageStatus =
    channel === "Call"
      ? clean(payload.disposition, 40).toLowerCase() === "missed"
        ? "Missed"
        : "Completed"
      : "Received";
  const data = await prisma.$transaction(async (tx) => {
    let conversation = providerThreadId
      ? await tx.communicationConversation.findFirst({
          where: { agencyId, clientId: client.id, channel, provider, providerThreadId, deletedAt: null },
        })
      : null;
    if (!conversation && channel === "Email" && emailInReplyTo) {
      const parent = await tx.communicationMessage.findFirst({
        where: {
          agencyId,
          channel: "Email",
          deletedAt: null,
          OR: [
            { emailMessageId: emailInReplyTo },
            { providerMessageId: emailInReplyTo },
          ],
        },
        select: { conversation: true },
      });
      conversation = parent?.conversation?.clientId === client.id
        ? parent.conversation
        : null;
    }
    if (!conversation && channel !== "Email") {
      conversation = await tx.communicationConversation.findFirst({
        where: {
          agencyId,
          clientId: client.id,
          caseId: caseItem?.id || null,
          channel,
          state: { not: "Closed" },
          deletedAt: null,
        },
        orderBy: { lastMessageAt: "desc" },
      });
    }
    if (!conversation) {
      conversation = await tx.communicationConversation.create({
        data: {
          agencyId,
          clientId: client.id,
          caseId: caseItem?.id || null,
          channel,
          subject,
          provider,
          providerThreadId,
          lastMessageAt: occurredAt,
          firstInboundAt: occurredAt,
          lastInboundAt: occurredAt,
          responseDueAt,
          resolutionDueAt,
          unreadCount: 0,
          state: "WaitingOnAgency",
          assignedToId:
            caseItem?.assignedUserId || client.assignedUserId || user.id,
          createdById: user.id,
        },
      });
    }
    const message = await tx.communicationMessage.create({
      data: {
        agencyId,
        clientId: client.id,
        caseId: caseItem?.id || null,
        conversationId: conversation.id,
        channel,
        direction: "Inbound",
        status: messageStatus,
        senderAddress,
        recipients,
        subject,
        bodyText,
        bodyHtml: clean(payload.bodyHtml, 100000) || null,
        provider,
        providerMessageId,
        emailMessageId:
          clean(
            payload.emailMessageId || payload.headers?.["message-id"],
            500,
          ) || null,
        emailInReplyTo,
        emailReferences: array(
          payload.emailReferences || payload.headers?.references,
        ),
        occurredAt,
        durationSeconds:
          payload.durationSeconds == null
            ? null
            : Math.max(0, Number(payload.durationSeconds) || 0),
        callDisposition: clean(payload.disposition, 80) || null,
        callRecordingUrl: httpsUrl(
          payload.recordingUrl || payload.callRecordingUrl,
        ),
        callTranscript:
          clean(
            payload.transcript ||
              payload.callTranscript ||
              payload.voicemailTranscript,
            50000,
          ) || null,
        metadata: { webhook: true, providerPayload: object(payload.metadata) },
        isRead: false,
      },
    });
    await tx.communicationConversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: occurredAt,
        firstInboundAt: conversation.firstInboundAt || occurredAt,
        lastInboundAt: occurredAt,
        responseDueAt,
        unreadCount: { increment: 1 },
        state: "WaitingOnAgency",
        isArchived: false,
        subject: conversation.subject || subject,
      },
    });
    await tx.communicationDeliveryEvent.create({
      data: {
        agencyId,
        messageId: message.id,
        type: "Received",
        providerEventId: clean(payload.providerEventId, 300) || null,
        providerTimestamp: occurredAt,
        details: `${channel} received from provider`,
        metadata: object(payload.metadata),
      },
    });
    return message;
  });
  if (channel === "Sms" && stopWords.has(clean(bodyText, 40).toLowerCase())) {
    await recordOptOut({
      agencyId,
      clientId: client.id,
      channel,
      senderAddress,
      payload,
      occurredAt,
    });
  }
  await recordCommunicationAudit({
    agencyId,
    conversationId: data.conversationId,
    messageId: data.id,
    action: "communication.inbound_received",
    details: `${channel} received from ${senderAddress || client.fullName}`,
    metadata: { provider, providerMessageId },
  });
  const conversation = await prisma.communicationConversation.findUnique({
    where: { id: data.conversationId },
  });
  await applyCommunicationAutomations({
    agencyId,
    trigger: "InboundReceived",
    message: data,
    conversation,
    caseItem,
    client,
  });
  return { data, duplicate: false, unmatched: false };
}

const eventStatus = {
  queued: "Queued",
  sent: "Sent",
  accepted: "Sent",
  delivered: "Delivered",
  bounced: "Bounced",
  failed: "Failed",
  rejected: "Failed",
  blocked: "Blocked",
  optedout: "OptedOut",
  completed: "Completed",
  missed: "Missed",
};

export async function ingestCommunicationProviderEvent(payload) {
  const agencyId = clean(payload.agencyId, 80);
  const provider = clean(payload.provider, 80);
  const providerMessageId = clean(
    payload.providerMessageId || payload.messageId || payload.callId,
    300,
  );
  const providerEventId =
    clean(payload.providerEventId || payload.eventId, 300) || null;
  const eventType = clean(payload.type || payload.event, 80)
    .toLowerCase()
    .replaceAll(/[^a-z]/g, "");
  const status = eventStatus[eventType];
  if (!agencyId || !provider || !providerMessageId || !status)
    throw createHttpError(
      400,
      "Valid agency, provider message, and event status are required",
    );
  await agencyContext(agencyId);
  if (
    providerEventId &&
    (await prisma.communicationDeliveryEvent.findFirst({
      where: { agencyId, providerEventId },
    }))
  )
    return { duplicate: true };
  const message = await prisma.communicationMessage.findFirst({
    where: { agencyId, provider, providerMessageId },
  });
  if (!message)
    throw createHttpError(404, "Provider message is not yet known to CaseDesk");
  const occurredAt = date(payload.occurredAt || payload.timestamp);
  const failureReason = ["Failed", "Bounced", "Blocked"].includes(status)
    ? clean(payload.reason || payload.error, 1000) ||
      `${provider} reported ${status}`
    : null;
  const data = await prisma.$transaction(async (tx) => {
    const updated = await tx.communicationMessage.update({
      where: { id: message.id },
      data: {
        status,
        ...(status === "Delivered" ? { deliveredAt: occurredAt } : {}),
        ...(["Failed", "Bounced", "Blocked"].includes(status)
          ? { failedAt: occurredAt, failureReason }
          : {}),
        ...(status === "Completed" && payload.durationSeconds != null
          ? {
              durationSeconds: Math.max(
                0,
                Number(payload.durationSeconds) || 0,
              ),
              callDisposition: clean(payload.disposition, 80) || "Completed",
            }
          : {}),
        ...(status === "Missed" ? { callDisposition: "Missed" } : {}),
        ...(httpsUrl(payload.recordingUrl || payload.callRecordingUrl)
          ? {
              callRecordingUrl: httpsUrl(
                payload.recordingUrl || payload.callRecordingUrl,
              ),
            }
          : {}),
        ...(payload.transcript ||
        payload.callTranscript ||
        payload.voicemailTranscript
          ? {
              callTranscript: clean(
                payload.transcript ||
                  payload.callTranscript ||
                  payload.voicemailTranscript,
                50000,
              ),
            }
          : {}),
      },
    });
    await tx.communicationDeliveryEvent.create({
      data: {
        agencyId,
        messageId: message.id,
        type: status,
        providerEventId,
        providerTimestamp: occurredAt,
        details: failureReason || `${provider} reported ${status}`,
        metadata: object(payload.metadata),
      },
    });
    return updated;
  });
  if (status === "OptedOut") {
    const recipient = array(message.recipients)[0];
    if (recipient)
      await recordOptOut({
        agencyId,
        clientId: message.clientId,
        channel: message.channel,
        senderAddress: recipient,
        payload,
        occurredAt,
      });
  }
  await recordCommunicationAudit({
    agencyId,
    conversationId: message.conversationId,
    messageId: message.id,
    action: `communication.${status.toLowerCase()}`,
    details: failureReason || `${provider} reported ${status}`,
    metadata: { providerEventId },
  });
  if (["Failed", "Bounced", "Blocked", "Missed"].includes(status)) {
    const context = await prisma.communicationConversation.findUnique({
      where: { id: message.conversationId },
      include: { case: true, client: true },
    });
    if (context)
      await applyCommunicationAutomations({
        agencyId,
        trigger: status === "Missed" ? "MissedCall" : "DeliveryFailed",
        message: data,
        conversation: context,
        caseItem: context.case,
        client: context.client,
      });
  }
  return { data, duplicate: false };
}

export async function receiveCommunicationInboundWebhook(req, res) {
  verifySecret(req);
  const result = await ingestInboundCommunication(object(req.body));
  res.status(result.duplicate ? 200 : 201).json(result);
}

export async function receiveCommunicationEventWebhook(req, res) {
  verifySecret(req);
  const result = await ingestCommunicationProviderEvent(object(req.body));
  res.status(200).json(result);
}
