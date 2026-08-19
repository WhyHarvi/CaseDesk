import path from "node:path";
import { randomUUID } from "node:crypto";
import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { AVATAR_BUCKET, DOCUMENT_BUCKET, downloadStorageFile, removeStorageFile, uploadStorageFile } from "../services/supabaseStorage.js";
import { broadcastInternalChatMessage, getRealtimeClientConfig } from "../services/supabaseRealtimeService.js";
import { CHAT_ATTACH_GRACE_MS, storeInternalChatAttachment } from "../services/internalChatAttachmentStorage.js";
import { notifyUsers } from "../services/notificationService.js";
import { avatarPresetBuffer, resolvedAvatarPreset } from "../services/staffAvatarPresetService.js";

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

const colleagueSelect = { id: true, fullName: true, email: true, role: true, jobTitle: true, avatarStorageKey: true, avatarMimeType: true, avatarPreset: true };

// A small fixed set, tapback-style (like iMessage's own reaction model)
// rather than a full emoji-picker library.
const REACTION_EMOJI = new Set(["👍", "❤️", "😂", "😮", "😢", "🙏"]);

const reactionSelect = { id: true, emoji: true, userId: true, user: { select: { id: true, fullName: true } } };

const messageInclude = {
  sender: { select: colleagueSelect },
  attachmentRecords: {
    select: { id: true, originalFilename: true, mimeType: true, fileSize: true, scanStatus: true, createdAt: true },
  },
  replyTo: {
    select: { id: true, bodyText: true, hasAttachment: true, deletedAt: true, sender: { select: colleagueSelect } },
  },
  reactions: { select: reactionSelect },
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

// Mirrors consultantProfileController.js's detectedImage() exactly — same
// magic-byte check, same allowed formats, same storage pattern, just for
// a thread's avatar instead of a user's.
function detectedImage(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { extension: ".jpg", mimeType: "image/jpeg" };
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { extension: ".png", mimeType: "image/png" };
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return { extension: ".webp", mimeType: "image/webp" };
  }
  throw createHttpError(400, "The uploaded file is not a valid JPG, PNG, or WebP image.", "INVALID_AVATAR");
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
        hasAvatar: row.thread.isGroup ? Boolean(row.thread.avatarStorageKey) : Boolean(others[0]),
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
      hasAvatar: thread.isGroup ? Boolean(thread.avatarStorageKey) : Boolean(others[0]),
      participants: thread.participants.map((item) => ({ ...item.user, lastReadAt: item.lastReadAt })),
      messages,
    },
    meta: { page, limit, total, hasMore: skip + messages.length < total },
  });
}

async function requireGroupThread(req) {
  const thread = await prisma.internalChatThread.findUnique({ where: { id: req.params.id } });
  if (!thread) throw createHttpError(404, "Conversation not found", "NOT_FOUND");
  if (!thread.isGroup) throw createHttpError(400, "Only groups can be renamed, get a photo, or have members added or removed", "VALIDATION_ERROR");
  return thread;
}

export async function updateThread(req, res) {
  await requireParticipant(req, req.params.id);
  const thread = await requireGroupThread(req);
  const name = req.body.name !== undefined ? clean(req.body.name, 120) || null : undefined;
  let nextAvatar = null;

  if (req.file) {
    const image = detectedImage(req.file.buffer);
    const storageKey = path.posix.join(req.auth.agencyId, "internal-chat-avatars", thread.id, `${randomUUID()}${image.extension}`);
    await uploadStorageFile(AVATAR_BUCKET, storageKey, req.file.buffer, image.mimeType);
    nextAvatar = { storageKey, mimeType: image.mimeType };
  }

  try {
    const updated = await prisma.internalChatThread.update({
      where: { id: thread.id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(nextAvatar ? { avatarStorageKey: nextAvatar.storageKey, avatarMimeType: nextAvatar.mimeType } : {}),
      },
    });
    if (nextAvatar && thread.avatarStorageKey) await removeStorageFile(AVATAR_BUCKET, thread.avatarStorageKey).catch(() => {});
    rebroadcast(req, { id: updated.id, occurredAt: updated.updatedAt });
    res.json({ data: { id: updated.id, name: updated.name, hasAvatar: Boolean(updated.avatarStorageKey) } });
  } catch (error) {
    if (nextAvatar) await removeStorageFile(AVATAR_BUCKET, nextAvatar.storageKey).catch(() => {});
    throw error;
  }
}

export async function serveThreadAvatar(req, res) {
  await requireParticipant(req, req.params.id);
  const thread = await prisma.internalChatThread.findUnique({
    where: { id: req.params.id },
    select: {
      isGroup: true,
      avatarStorageKey: true,
      avatarMimeType: true,
      participants: {
        where: { userId: { not: req.auth.userId } },
        take: 1,
        select: { user: { select: { id: true, avatarStorageKey: true, avatarMimeType: true, avatarPreset: true } } },
      },
    },
  });
  if (!thread) throw createHttpError(404, "Conversation not found", "NOT_FOUND");
  const person = thread.isGroup ? null : thread.participants[0]?.user;
  const storageKey = thread.isGroup ? thread.avatarStorageKey : person?.avatarStorageKey;
  const mimeType = thread.isGroup ? thread.avatarMimeType : person?.avatarMimeType;
  const uploaded = storageKey ? await downloadStorageFile(AVATAR_BUCKET, storageKey, { allowMissing: true }) : null;
  const buffer = uploaded || (!thread.isGroup && person ? await avatarPresetBuffer(resolvedAvatarPreset(person)) : null);
  if (!buffer) throw createHttpError(404, "This conversation has no photo", "NOT_FOUND");
  res.type(uploaded ? mimeType || "application/octet-stream" : "image/png");
  res.send(buffer);
}

export async function serveStaffAvatar(req, res) {
  const user = await prisma.user.findFirst({
    where: { id: req.params.userId, agencyId: req.auth.agencyId, role: { in: ["consultant", "frontdesk"] } },
    select: { id: true, avatarStorageKey: true, avatarMimeType: true, avatarPreset: true },
  });
  if (!user) throw createHttpError(404, "Staff profile not found", "NOT_FOUND");
  const uploaded = user.avatarStorageKey
    ? await downloadStorageFile(AVATAR_BUCKET, user.avatarStorageKey, { allowMissing: true })
    : null;
  const buffer = uploaded || await avatarPresetBuffer(resolvedAvatarPreset(user));
  res.set("Cache-Control", "private, max-age=300");
  res.type(uploaded ? user.avatarMimeType || "application/octet-stream" : "image/png");
  res.send(buffer);
}

export async function addParticipants(req, res) {
  await requireParticipant(req, req.params.id);
  const thread = await requireGroupThread(req);
  const requestedIds = [...new Set(jsonArray(req.body.userIds).map(String).filter(Boolean))];
  if (!requestedIds.length) throw createHttpError(400, "Choose at least one colleague to add", "VALIDATION_ERROR");

  const existingParticipantIds = new Set(
    (await prisma.internalChatParticipant.findMany({ where: { threadId: thread.id }, select: { userId: true } })).map((item) => item.userId),
  );
  const newIds = requestedIds.filter((id) => !existingParticipantIds.has(id));
  if (!newIds.length) throw createHttpError(409, "Everyone you selected is already in this group", "VALIDATION_ERROR");

  const validTargets = await prisma.user.findMany({
    where: {
      id: { in: newIds },
      agencyId: req.auth.agencyId,
      status: "active",
      memberships: { some: { agencyId: req.auth.agencyId, isActive: true, role: { in: [...staffRoles] } } },
    },
    select: { id: true },
  });
  if (validTargets.length !== newIds.length) throw createHttpError(404, "One or more colleagues could not be found", "NOT_FOUND");

  await prisma.internalChatParticipant.createMany({
    data: newIds.map((userId) => ({ agencyId: req.auth.agencyId, threadId: thread.id, userId })),
  });
  rebroadcast(req, { id: thread.id, occurredAt: new Date() });
  res.status(201).json({ success: true });
}

export async function removeParticipant(req, res) {
  await requireParticipant(req, req.params.id);
  const thread = await requireGroupThread(req);
  const remainingCount = await prisma.internalChatParticipant.count({ where: { threadId: thread.id } });
  if (remainingCount <= 2) throw createHttpError(409, "A group needs at least two people — start a new one instead of emptying this one", "VALIDATION_ERROR");
  const participant = await prisma.internalChatParticipant.findUnique({
    where: { threadId_userId: { threadId: thread.id, userId: req.params.userId } },
  });
  if (!participant) throw createHttpError(404, "That person is not in this group", "NOT_FOUND");
  await prisma.internalChatParticipant.delete({ where: { id: participant.id } });
  rebroadcast(req, { id: thread.id, occurredAt: new Date() });
  res.json({ success: true });
}

export async function createMessage(req, res) {
  const participant = await requireParticipant(req, req.params.id);
  const bodyText = clean(req.body.bodyText, 5000);
  const hasAttachment = req.body.hasAttachment === true;
  if (!bodyText && !hasAttachment) throw createHttpError(400, "Message content is required", "VALIDATION_ERROR");
  const clientMessageId = clean(req.body.clientMessageId, 100) || null;
  const replyToId = clean(req.body.replyToId, 100) || null;

  if (clientMessageId) {
    const existing = await prisma.internalChatMessage.findFirst({
      where: { agencyId: req.auth.agencyId, threadId: req.params.id, clientMessageId },
      include: messageInclude,
    });
    if (existing) return res.status(200).json({ data: existing });
  }

  if (replyToId) {
    const parent = await prisma.internalChatMessage.findFirst({
      where: { id: replyToId, threadId: req.params.id, deletedAt: null },
      select: { id: true },
    });
    if (!parent) throw createHttpError(404, "The message you're replying to could not be found", "NOT_FOUND");
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
        replyToId,
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
  // Neither of these needs to finish before the sender gets their response
  // back — notifyUsers alone measured ~1.5s (preference lookups + delivery
  // dispatch) and the realtime broadcast another ~0.9s on a real request,
  // which was making every send feel stalled. Both already swallow their
  // own errors, so not awaiting them changes nothing except when they run.
  notifyUsers({
    agencyId: req.auth.agencyId,
    recipientIds: otherParticipants.map((item) => item.userId),
    actorUserId: req.auth.userId,
    type: "internal_chat.message_received",
    category: "communications",
    title: "New team chat message",
    body: bodyText || "Sent an attachment",
    entityType: "internalChatThread",
    entityId: req.params.id,
    actionUrl: `/app/chats?thread=${req.params.id}&kind=internal`,
    destinationKey: "chats",
    dedupeKey: `thread:${req.params.id}:unread`,
    aggregate: true,
  }).catch(() => {});

  // Attachment-only messages defer their broadcast until the file finishes
  // uploading (see storeInternalChatAttachment) so participants don't see
  // an empty bubble before the image/file appears.
  if (!hasAttachment) {
    broadcastInternalChatMessage({
      agencyId: req.auth.agencyId,
      threadId: req.params.id,
      event: "message",
      payload: { messageId: message.id, threadId: req.params.id, occurredAt: message.occurredAt },
    }).catch(() => {});
  }

  res.status(201).json({ data: message });
}

function rebroadcast(req, message) {
  broadcastInternalChatMessage({
    agencyId: req.auth.agencyId,
    threadId: req.params.id,
    event: "message",
    payload: { messageId: message.id, threadId: req.params.id, occurredAt: message.occurredAt },
  }).catch(() => {});
}

// Internal chat only — client-chat messages are part of the case record
// and never get a silent edit path (see communicationController.js).
export async function updateMessage(req, res) {
  await requireParticipant(req, req.params.id);
  const bodyText = clean(req.body.bodyText, 5000);
  if (!bodyText) throw createHttpError(400, "Message content is required", "VALIDATION_ERROR");
  const message = await prisma.internalChatMessage.findFirst({
    where: { id: req.params.messageId, threadId: req.params.id, deletedAt: null },
  });
  if (!message) throw createHttpError(404, "Message not found", "NOT_FOUND");
  if (message.senderId !== req.auth.userId) throw createHttpError(403, "You can only edit your own messages", "FORBIDDEN");
  const updated = await prisma.internalChatMessage.update({
    where: { id: message.id },
    data: { bodyText, editedAt: new Date() },
    include: messageInclude,
  });
  rebroadcast(req, updated);
  res.json({ data: updated });
}

export async function deleteMessage(req, res) {
  await requireParticipant(req, req.params.id);
  const message = await prisma.internalChatMessage.findFirst({
    where: { id: req.params.messageId, threadId: req.params.id, deletedAt: null },
  });
  if (!message) throw createHttpError(404, "Message not found", "NOT_FOUND");
  if (message.senderId !== req.auth.userId) throw createHttpError(403, "You can only delete your own messages", "FORBIDDEN");
  await prisma.internalChatMessage.update({ where: { id: message.id }, data: { deletedAt: new Date() } });
  rebroadcast(req, message);
  res.json({ success: true });
}

export async function toggleReaction(req, res) {
  await requireParticipant(req, req.params.id);
  const emoji = clean(req.body.emoji, 8);
  if (!REACTION_EMOJI.has(emoji)) throw createHttpError(400, "Unsupported reaction", "VALIDATION_ERROR");
  const message = await prisma.internalChatMessage.findFirst({
    where: { id: req.params.messageId, threadId: req.params.id, deletedAt: null },
  });
  if (!message) throw createHttpError(404, "Message not found", "NOT_FOUND");
  const existing = await prisma.internalChatMessageReaction.findUnique({
    where: { messageId_userId_emoji: { messageId: message.id, userId: req.auth.userId, emoji } },
  });
  if (existing) {
    await prisma.internalChatMessageReaction.delete({ where: { id: existing.id } });
  } else {
    await prisma.internalChatMessageReaction.create({
      data: { agencyId: req.auth.agencyId, messageId: message.id, userId: req.auth.userId, emoji },
    });
  }
  const reactions = await prisma.internalChatMessageReaction.findMany({
    where: { messageId: message.id },
    select: reactionSelect,
  });
  rebroadcast(req, message);
  res.json({ data: reactions });
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
