import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { DOCUMENT_BUCKET, downloadStorageFile } from "../services/supabaseStorage.js";
import { broadcastInternalChatMessage, getRealtimeClientConfig } from "../services/supabaseRealtimeService.js";
import { CHAT_ATTACH_GRACE_MS, storeInternalChatAttachment } from "../services/internalChatAttachmentStorage.js";
import { notifyUsers } from "../services/notificationService.js";

const staffRoles = new Set(["admin", "consultant", "frontdesk"]);

const clean = (value, max = 500) => String(value ?? "").trim().slice(0, max);

function jsonArray(value, limit = 50) {
  return Array.isArray(value) ? value.slice(0, limit) : [];
}

function pagination(query, defaultLimit = 50) {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || defaultLimit, 1), 100);
  return { page, limit, skip: (page - 1) * limit };
}

const colleagueSelect = { id: true, fullName: true, email: true, role: true, jobTitle: true };

const messageInclude = {
  sender: { select: colleagueSelect },
  attachmentRecords: {
    select: { id: true, originalFilename: true, mimeType: true, fileSize: true, scanStatus: true, createdAt: true },
  },
};

async function requireParticipant(req, threadId) {
  const participant = await prisma.internalChatParticipant.findUnique({
    where: { threadId_userId: { threadId, userId: req.auth.userId } },
  });
  if (!participant) throw createHttpError(404, "Conversation not found", "NOT_FOUND");
  return participant;
}

function displayName(thread, others) {
  return thread.name || others.map((user) => user.fullName).join(", ") || "Team chat";
}

export async function listMyColleagues(req, res) {
  const query = clean(req.query.q, 120).toLowerCase();
  const users = await prisma.user.findMany({
    where: {
      agencyId: req.auth.agencyId,
      status: "active",
      id: { not: req.auth.userId },
      memberships: { some: { agencyId: req.auth.agencyId, isActive: true, role: { in: [...staffRoles] } } },
    },
    select: colleagueSelect,
    orderBy: { fullName: "asc" },
  });
  const data = query
    ? users.filter((user) => user.fullName.toLowerCase().includes(query) || user.email.toLowerCase().includes(query))
    : users;
  res.json({ data });
}

export async function listThreads(req, res) {
  const rows = await prisma.internalChatParticipant.findMany({
    where: { userId: req.auth.userId, thread: { agencyId: req.auth.agencyId } },
    include: {
      thread: {
        include: {
          participants: { include: { user: { select: colleagueSelect } } },
          messages: {
            where: { deletedAt: null },
            orderBy: { occurredAt: "desc" },
            take: 1,
            include: { sender: { select: colleagueSelect } },
          },
        },
      },
    },
  });

  const data = await Promise.all(
    rows.map(async (row) => {
      const unreadCount = await prisma.internalChatMessage.count({
        where: {
          threadId: row.threadId,
          deletedAt: null,
          senderId: { not: req.auth.userId },
          occurredAt: { gt: row.lastReadAt || new Date(0) },
        },
      });
      const others = row.thread.participants.filter((item) => item.userId !== req.auth.userId).map((item) => item.user);
      return {
        id: row.thread.id,
        isGroup: row.thread.isGroup,
        name: displayName(row.thread, others),
        participants: others,
        lastMessageAt: row.thread.lastMessageAt,
        latestMessage: row.thread.messages[0] || null,
        unreadCount,
      };
    }),
  );
  data.sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
  res.json({ data });
}

export async function createThread(req, res) {
  const requestedIds = [...new Set(jsonArray(req.body.participantUserIds).map(String).filter(Boolean))];
  if (!requestedIds.length) throw createHttpError(400, "Choose at least one colleague to message", "VALIDATION_ERROR");
  if (requestedIds.includes(req.auth.userId))
    throw createHttpError(400, "You're already in every conversation you start", "VALIDATION_ERROR");

  const validTargets = await prisma.user.findMany({
    where: {
      id: { in: requestedIds },
      agencyId: req.auth.agencyId,
      status: "active",
      memberships: { some: { agencyId: req.auth.agencyId, isActive: true, role: { in: [...staffRoles] } } },
    },
    select: { id: true },
  });
  if (validTargets.length !== requestedIds.length)
    throw createHttpError(404, "One or more colleagues could not be found", "NOT_FOUND");

  const allParticipantIds = [...new Set([req.auth.userId, ...requestedIds])];
  const isGroup = allParticipantIds.length > 2;
  const name = isGroup ? clean(req.body.name, 120) || null : null;

  if (!isGroup) {
    const existing = await prisma.internalChatThread.findFirst({
      where: {
        agencyId: req.auth.agencyId,
        isGroup: false,
        AND: allParticipantIds.map((userId) => ({ participants: { some: { userId } } })),
      },
      select: { id: true },
    });
    if (existing) return res.json({ data: existing });
  }

  const thread = await prisma.internalChatThread.create({
    data: {
      agencyId: req.auth.agencyId,
      isGroup,
      name,
      createdById: req.auth.userId,
      participants: {
        create: allParticipantIds.map((userId) => ({ agencyId: req.auth.agencyId, userId })),
      },
    },
    select: { id: true },
  });
  res.status(201).json({ data: thread });
}

export async function getThread(req, res) {
  await requireParticipant(req, req.params.id);
  const { page, limit, skip } = pagination(req.query, 50);
  const thread = await prisma.internalChatThread.findUnique({
    where: { id: req.params.id },
    include: { participants: { include: { user: { select: colleagueSelect } } } },
  });
  if (!thread) throw createHttpError(404, "Conversation not found", "NOT_FOUND");

  const [messages, total] = await Promise.all([
    prisma.internalChatMessage.findMany({
      where: { threadId: thread.id, deletedAt: null },
      include: messageInclude,
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      skip,
      take: limit,
    }),
    prisma.internalChatMessage.count({ where: { threadId: thread.id, deletedAt: null } }),
  ]);

  const others = thread.participants.filter((item) => item.userId !== req.auth.userId).map((item) => item.user);
  res.json({
    data: {
      id: thread.id,
      isGroup: thread.isGroup,
      name: displayName(thread, others),
      participants: thread.participants.map((item) => ({ ...item.user, lastReadAt: item.lastReadAt })),
      messages,
    },
    meta: { page, limit, total, hasMore: skip + messages.length < total },
  });
}

export async function createMessage(req, res) {
  const participant = await requireParticipant(req, req.params.id);
  const bodyText = clean(req.body.bodyText, 5000);
  const hasAttachment = req.body.hasAttachment === true;
  if (!bodyText && !hasAttachment) throw createHttpError(400, "Message content is required", "VALIDATION_ERROR");
  const clientMessageId = clean(req.body.clientMessageId, 100) || null;

  if (clientMessageId) {
    const existing = await prisma.internalChatMessage.findFirst({
      where: { agencyId: req.auth.agencyId, threadId: req.params.id, clientMessageId },
      include: messageInclude,
    });
    if (existing) return res.status(200).json({ data: existing });
  }

  const occurredAt = new Date();
  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.internalChatMessage.create({
      data: {
        agencyId: req.auth.agencyId,
        threadId: req.params.id,
        senderId: req.auth.userId,
        bodyText: bodyText || null,
        hasAttachment,
        clientMessageId,
        occurredAt,
      },
      include: messageInclude,
    });
    await tx.internalChatThread.update({ where: { id: req.params.id }, data: { lastMessageAt: occurredAt } });
    await tx.internalChatParticipant.update({ where: { id: participant.id }, data: { lastReadAt: occurredAt } });
    return created;
  });

  const otherParticipants = await prisma.internalChatParticipant.findMany({
    where: { threadId: req.params.id, userId: { not: req.auth.userId } },
    select: { userId: true },
  });
  await notifyUsers({
    agencyId: req.auth.agencyId,
    recipientIds: otherParticipants.map((item) => item.userId),
    actorUserId: req.auth.userId,
    type: "internal_chat.message_received",
    category: "communications",
    title: "New team chat message",
    body: bodyText || "Sent an attachment",
    entityType: "internalChatThread",
    entityId: req.params.id,
    actionUrl: `/team-chat?thread=${req.params.id}`,
    destinationKey: "teamChat",
    dedupeKey: `thread:${req.params.id}:unread`,
    aggregate: true,
  }).catch(() => {});

  // Attachment-only messages defer their broadcast until the file finishes
  // uploading (see storeInternalChatAttachment) so participants don't see
  // an empty bubble before the image/file appears.
  if (!hasAttachment) {
    await broadcastInternalChatMessage({
      agencyId: req.auth.agencyId,
      threadId: req.params.id,
      event: "message",
      payload: { messageId: message.id, threadId: req.params.id, occurredAt: message.occurredAt },
    }).catch(() => {});
  }

  res.status(201).json({ data: message });
}

export async function getThreadRealtimeConfig(req, res) {
  await requireParticipant(req, req.params.id);
  res.json({
    data: getRealtimeClientConfig({
      userId: req.auth.userId,
      agencyId: req.auth.agencyId,
      threadId: req.params.id,
      role: req.auth.role,
    }),
  });
}

export async function markThreadRead(req, res) {
  const participant = await requireParticipant(req, req.params.id);
  await prisma.internalChatParticipant.update({ where: { id: participant.id }, data: { lastReadAt: new Date() } });
  res.json({ success: true });
}

export async function uploadThreadAttachment(req, res) {
  if (!req.file) throw createHttpError(400, "Choose a file to attach", "VALIDATION_ERROR");
  await requireParticipant(req, req.params.id);
  const message = await prisma.internalChatMessage.findFirst({
    where: { id: req.params.messageId, agencyId: req.auth.agencyId, threadId: req.params.id, deletedAt: null },
  });
  if (!message) throw createHttpError(404, "Message not found", "NOT_FOUND");
  const attachAllowed = message.senderId === req.auth.userId && Date.now() - message.createdAt.getTime() < CHAT_ATTACH_GRACE_MS;
  if (!attachAllowed) throw createHttpError(409, "This message can no longer accept an attachment", "ATTACHMENT_WINDOW_CLOSED");
  const data = await storeInternalChatAttachment({ agencyId: req.auth.agencyId, message, file: req.file, uploadedById: req.auth.userId });
  res.status(201).json({ data });
}

export async function serveThreadAttachment(req, res) {
  await requireParticipant(req, req.params.id);
  const attachment = await prisma.internalChatAttachment.findFirst({
    where: { id: req.params.attachmentId, agencyId: req.auth.agencyId, message: { threadId: req.params.id, deletedAt: null } },
  });
  if (!attachment) throw createHttpError(404, "Attachment not found", "NOT_FOUND");
  if (attachment.scanStatus === "Rejected")
    throw createHttpError(409, "This attachment was rejected by the security scanner", "ATTACHMENT_REJECTED");
  const buffer = await downloadStorageFile(DOCUMENT_BUCKET, attachment.storageKey, { allowMissing: true });
  if (!buffer) throw createHttpError(404, "Stored attachment file was not found", "NOT_FOUND");
  res.setHeader("content-type", attachment.mimeType || "application/octet-stream");
  res.setHeader("content-disposition", `inline; filename*=UTF-8''${encodeURIComponent(attachment.originalFilename)}`);
  res.send(buffer);
}
