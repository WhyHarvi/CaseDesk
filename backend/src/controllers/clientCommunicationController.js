import { createHash, randomBytes } from "node:crypto";
import prisma from "../services/prisma/client.js";
import { applyCommunicationAutomations } from "../services/communicationAutomationService.js";
import { recordCommunicationAudit } from "../services/communicationAudit.js";
import { requireCommunicationPermission } from "../services/communicationPermissions.js";
import {
  communicationResolutionDueAt,
  communicationResponseDueAt,
} from "../services/communicationSlaService.js";
import {
  broadcastCaseCommunication,
  getRealtimeClientConfig,
} from "../services/supabaseRealtimeService.js";
import { DOCUMENT_BUCKET, downloadStorageFile } from "../services/supabaseStorage.js";
import { CHAT_ATTACH_GRACE_MS, storeCommunicationAttachment } from "../services/communicationAttachmentStorage.js";
import { getEffectiveClientCommunicationPreference } from "../services/clientCommunicationPolicyService.js";
import { createHttpError } from "../utils/http.js";
import { caseAccessWhere } from "../middleware/authorization.js";

const clean = (value, max = 500) =>
  String(value ?? "")
    .trim()
    .slice(0, max);
const attempts = new Map();
const hashToken = (token) => createHash("sha256").update(token).digest("hex");

async function scopedCase(req, caseId) {
  const data = await prisma.case.findFirst({
    where: {
      id: caseId,
      agencyId: req.user.agencyId,
      ...caseAccessWhere(req),
    },
    include: { client: true },
  });
  if (!data) throw createHttpError(404, "Case not found");
  return data;
}

async function validAccess(token) {
  const normalized = clean(token, 128);
  if (!/^[a-f\d]{64}$/i.test(normalized))
    throw createHttpError(404, "Secure chat link not found");
  const data = await prisma.clientCommunicationAccess.findUnique({
    where: { tokenHash: hashToken(normalized) },
    include: {
      agency: { select: { id: true, name: true, email: true, phone: true } },
      client: { select: { id: true, fullName: true, assignedUserId: true } },
      case: {
        select: {
          id: true,
          caseType: true,
          stage: true,
          status: true,
          assignedUserId: true,
        },
      },
    },
  });
  if (!data || data.revokedAt || data.expiresAt <= new Date())
    throw createHttpError(
      410,
      "This secure chat link has expired or was revoked. Ask your consultant for a new link.",
    );
  const preference = await getEffectiveClientCommunicationPreference({
    agencyId: data.agencyId,
    clientId: data.clientId,
  });
  if (preference?.doNotContact || preference?.allowChat === false)
    throw createHttpError(
      403,
      "Secure chat is currently disabled for this client.",
    );
  return data;
}

function enforceRateLimit(key) {
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || now - current.startedAt > 60_000) {
    attempts.set(key, { startedAt: now, count: 1 });
    return;
  }
  current.count += 1;
  if (current.count > 30)
    throw createHttpError(
      429,
      "Too many messages were submitted. Wait a minute and try again.",
    );
}

export async function getCaseClientChatAccess(req, res) {
  await requireCommunicationPermission(req, "canUseChat");
  const caseItem = await scopedCase(req, req.params.caseId);
  const data = await prisma.clientCommunicationAccess.findFirst({
    where: {
      agencyId: req.user.agencyId,
      caseId: caseItem.id,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, expiresAt: true, lastUsedAt: true, createdAt: true },
  });
  res.json({ data });
}

export async function createCaseClientChatAccess(req, res) {
  await requireCommunicationPermission(req, "canUseChat");
  const caseItem = await scopedCase(req, req.params.caseId);
  const preference = await getEffectiveClientCommunicationPreference({
    agencyId: req.user.agencyId,
    clientId: caseItem.clientId,
  });
  if (preference.doNotContact || !preference.allowChat)
    throw createHttpError(
      409,
      "Secure chat is disabled by the workspace client policy or this client's preferences.",
    );
  const expiresInDays = Math.min(
    Math.max(Number(req.body.expiresInDays) || 30, 1),
    365,
  );
  const token = randomBytes(32).toString("hex");
  const now = new Date();
  await prisma.clientCommunicationAccess.updateMany({
    where: {
      agencyId: req.user.agencyId,
      caseId: caseItem.id,
      revokedAt: null,
    },
    data: { revokedAt: now },
  });
  const data = await prisma.clientCommunicationAccess.create({
    data: {
      agencyId: req.user.agencyId,
      clientId: caseItem.clientId,
      caseId: caseItem.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(now.getTime() + expiresInDays * 86_400_000),
      createdById: req.user.id,
    },
  });
  const base = String(
    process.env.FRONTEND_URL || "http://localhost:5173",
  ).replace(/\/+$/, "");
  const url = `${base}/client-chat/${token}`;
  await recordCommunicationAudit({
    agencyId: req.user.agencyId,
    userId: req.user.id,
    action: "communication.client_chat_link_created",
    details: `Secure chat access created for ${caseItem.client.fullName}`,
    metadata: {
      caseId: caseItem.id,
      accessId: data.id,
      expiresAt: data.expiresAt,
    },
  });
  res.status(201).json({
    data: {
      id: data.id,
      url,
      expiresAt: data.expiresAt,
      createdAt: data.createdAt,
    },
  });
}

export async function revokeCaseClientChatAccess(req, res) {
  await requireCommunicationPermission(req, "canUseChat");
  const caseItem = await scopedCase(req, req.params.caseId);
  const result = await prisma.clientCommunicationAccess.updateMany({
    where: {
      agencyId: req.user.agencyId,
      caseId: caseItem.id,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
  await recordCommunicationAudit({
    agencyId: req.user.agencyId,
    userId: req.user.id,
    action: "communication.client_chat_link_revoked",
    details: `Secure chat access revoked for ${caseItem.client.fullName}`,
    metadata: { caseId: caseItem.id, count: result.count },
  });
  res.status(204).send();
}

export async function getClientChat(req, res) {
  const access = await validAccess(req.params.token);
  await prisma.clientCommunicationAccess.update({
    where: { id: access.id },
    data: { lastUsedAt: new Date() },
  });
  const messages = await prisma.communicationMessage.findMany({
    where: {
      agencyId: access.agencyId,
      caseId: access.caseId,
      channel: "Chat",
      direction: { in: ["Inbound", "Outbound"] },
      deletedAt: null,
    },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    take: 200,
    select: {
      id: true,
      direction: true,
      status: true,
      bodyText: true,
      occurredAt: true,
      senderUser: { select: { fullName: true } },
      attachmentRecords: {
        select: { id: true, originalFilename: true, mimeType: true, fileSize: true, scanStatus: true, createdAt: true },
      },
    },
  });
  res.json({
    data: {
      agency: access.agency,
      client: { id: access.client.id, fullName: access.client.fullName },
      case: {
        id: access.case.id,
        caseType: access.case.caseType,
        stage: access.case.stage,
        status: access.case.status,
      },
      expiresAt: access.expiresAt,
      messages,
      realtime: getRealtimeClientConfig({
        userId: `client:${access.clientId}`,
        agencyId: access.agencyId,
        caseId: access.caseId,
        role: "client",
      }),
    },
  });
}

export async function markClientChatRead(req, res) {
  const access = await validAccess(req.params.token);
  await prisma.communicationConversation.updateMany({
    where: { agencyId: access.agencyId, caseId: access.caseId, channel: "Chat", deletedAt: null },
    data: { clientLastReadAt: new Date() },
  });
  res.json({ success: true });
}

export async function createClientChatMessage(req, res) {
  const access = await validAccess(req.params.token);
  enforceRateLimit(access.tokenHash);
  const bodyText = clean(req.body.bodyText, 5000);
  const hasAttachment = req.body.hasAttachment === true;
  if (!bodyText && !hasAttachment) throw createHttpError(400, "Write a message before sending");
  const clientMessageId = clean(req.body.clientMessageId, 200) || null;
  if (clientMessageId) {
    const duplicate = await prisma.communicationMessage.findFirst({
      where: {
        agencyId: access.agencyId,
        provider: "ClientPortal",
        providerMessageId: clientMessageId,
      },
    });
    if (duplicate)
      return res.json({ data: duplicate, meta: { duplicate: true } });
  }
  const occurredAt = new Date();
  const responseDueAt = await communicationResponseDueAt(
    access.agencyId,
    occurredAt,
  );
  const resolutionDueAt = await communicationResolutionDueAt(
    access.agencyId,
    occurredAt,
  );
  const owner =
    access.case.assignedUserId ||
    access.client.assignedUserId ||
    (
      await prisma.user.findFirst({
        where: { agencyId: access.agencyId },
        orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      })
    )?.id;
  if (!owner)
    throw createHttpError(
      409,
      "No consultant is assigned to receive this chat",
    );
  const result = await prisma.$transaction(async (tx) => {
    let conversation = await tx.communicationConversation.findFirst({
      where: {
        agencyId: access.agencyId,
        caseId: access.caseId,
        channel: "Chat",
        state: { not: "Closed" },
        deletedAt: null,
      },
      orderBy: { lastMessageAt: "desc" },
    });
    if (!conversation)
      conversation = await tx.communicationConversation.create({
        data: {
          agencyId: access.agencyId,
          clientId: access.clientId,
          caseId: access.caseId,
          channel: "Chat",
          subject: "Secure client chat",
          provider: "Supabase",
          providerThreadId: access.id,
          assignedToId: owner,
          state: "WaitingOnAgency",
          firstInboundAt: occurredAt,
          lastInboundAt: occurredAt,
          responseDueAt,
          resolutionDueAt,
          lastMessageAt: occurredAt,
          unreadCount: 0,
          createdById: owner,
        },
      });
    const message = await tx.communicationMessage.create({
      data: {
        agencyId: access.agencyId,
        clientId: access.clientId,
        caseId: access.caseId,
        conversationId: conversation.id,
        channel: "Chat",
        direction: "Inbound",
        status: "Received",
        senderAddress: `client:${access.clientId}`,
        recipients: [],
        bodyText,
        provider: "ClientPortal",
        providerMessageId: clientMessageId,
        occurredAt,
        isRead: false,
        metadata: { accessId: access.id },
      },
    });
    conversation = await tx.communicationConversation.update({
      where: { id: conversation.id },
      data: {
        state: "WaitingOnAgency",
        isArchived: false,
        firstInboundAt: conversation.firstInboundAt || occurredAt,
        lastInboundAt: occurredAt,
        responseDueAt,
        lastMessageAt: occurredAt,
        unreadCount: { increment: 1 },
      },
    });
    await tx.communicationDeliveryEvent.create({
      data: {
        agencyId: access.agencyId,
        messageId: message.id,
        type: "Received",
        providerTimestamp: occurredAt,
        details: "Secure client chat message received",
      },
    });
    return { message, conversation };
  });
  await prisma.clientCommunicationAccess.update({
    where: { id: access.id },
    data: { lastUsedAt: occurredAt },
  });
  await recordCommunicationAudit({
    agencyId: access.agencyId,
    conversationId: result.conversation.id,
    messageId: result.message.id,
    action: "communication.client_chat_received",
    details: `Secure chat received from ${access.client.fullName}`,
    metadata: { accessId: access.id },
  });
  await applyCommunicationAutomations({
    agencyId: access.agencyId,
    trigger: "InboundReceived",
    message: result.message,
    conversation: result.conversation,
    caseItem: access.case,
    client: access.client,
  });
  // An attachment-only message broadcasts once the file finishes
  // uploading/scanning, not here — otherwise staff see an empty bubble
  // flash before the image or file appears in it.
  if (!hasAttachment)
    await broadcastCaseCommunication({
      agencyId: access.agencyId,
      caseId: access.caseId,
      event: "message",
      payload: {
        messageId: result.message.id,
        conversationId: result.conversation.id,
        occurredAt,
      },
    }).catch(() => {});
  res.status(201).json({ data: result.message });
}

export async function uploadClientChatAttachment(req, res) {
  if (!req.file) throw createHttpError(400, "Choose a file to attach");
  const access = await validAccess(req.params.token);
  enforceRateLimit(access.tokenHash);
  const message = await prisma.communicationMessage.findFirst({
    where: {
      id: req.params.id,
      agencyId: access.agencyId,
      caseId: access.caseId,
      channel: "Chat",
      direction: "Inbound",
      provider: "ClientPortal",
      deletedAt: null,
    },
  });
  if (!message) throw createHttpError(404, "Message not found");
  // There's no authenticated user on this anonymous token-link flow to
  // check "own message" against — scoping to this exact case + this
  // provider + a short grace window is what stands in for it here.
  if (Date.now() - message.createdAt.getTime() >= CHAT_ATTACH_GRACE_MS)
    throw createHttpError(409, "This message can no longer accept an attachment");
  // uploadedById is a required FK to a real staff User — there's no
  // anonymous-uploader concept in that table, so this attributes the file
  // to the case's assigned consultant, same as how senderUserId is already
  // null (not the client) for this surface's inbound messages.
  const uploadedById = access.case.assignedUserId || access.client.assignedUserId;
  if (!uploadedById) throw createHttpError(409, "No consultant is assigned to receive this file");
  const data = await storeCommunicationAttachment({
    agencyId: access.agencyId,
    message,
    file: req.file,
    uploadedById,
  });
  res.status(201).json({ data });
}

export async function serveClientChatAttachment(req, res) {
  const access = await validAccess(req.params.token);
  const data = await prisma.communicationAttachment.findFirst({
    where: {
      id: req.params.attachmentId,
      agencyId: access.agencyId,
      message: { id: req.params.id, caseId: access.caseId, channel: "Chat", deletedAt: null },
    },
  });
  if (!data) throw createHttpError(404, "Attachment not found");
  if (data.scanStatus === "Rejected")
    throw createHttpError(409, "This attachment was rejected by the security scanner");
  const buffer = await downloadStorageFile(DOCUMENT_BUCKET, data.storageKey, { allowMissing: true });
  if (!buffer) throw createHttpError(404, "Stored attachment file was not found");
  res.setHeader("content-type", data.mimeType || "application/octet-stream");
  res.setHeader(
    "content-disposition",
    `inline; filename*=UTF-8''${encodeURIComponent(data.originalFilename || "attachment")}`,
  );
  res.send(buffer);
}
