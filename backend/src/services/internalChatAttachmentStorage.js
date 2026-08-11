import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import prisma from "./prisma/client.js";
import { DOCUMENT_BUCKET, removeStorageFile, uploadStorageFile } from "./supabaseStorage.js";
import { broadcastInternalChatMessage } from "./supabaseRealtimeService.js";
import { extensionOf, scanFile } from "./communicationAttachmentStorage.js";

export { CHAT_ATTACH_GRACE_MS } from "./communicationAttachmentStorage.js";

// The internal-chat counterpart of storeCommunicationAttachment — same
// upload+scan+record+cleanup-on-error shape, reusing scanFile/extensionOf
// rather than duplicating them, but writing InternalChatAttachment rows
// against InternalChatMessage instead of the client-communication tables.
export async function storeInternalChatAttachment({ agencyId, message, file, uploadedById }) {
  const storageKey = path.posix.join(
    agencyId,
    "internal-chat",
    message.threadId,
    `${randomUUID()}${extensionOf(file.originalname)}`,
  );
  await uploadStorageFile(DOCUMENT_BUCKET, storageKey, file.buffer, file.mimetype);
  try {
    const scan = await scanFile(file);
    const data = await prisma.internalChatAttachment.create({
      data: {
        agencyId,
        messageId: message.id,
        storageKey,
        originalFilename: file.originalname,
        mimeType: file.mimetype,
        fileSize: file.size,
        fileHash: createHash("sha256").update(file.buffer).digest("hex"),
        scanStatus: scan.status,
        scanDetails: scan.details,
        uploadedById,
      },
    });
    // For an attachment-only message, this is the broadcast that was
    // deferred at message-creation time — participants now see a fully
    // formed bubble instead of an empty one that fills in a moment later.
    await broadcastInternalChatMessage({
      agencyId,
      threadId: message.threadId,
      event: "message",
      payload: { messageId: message.id, threadId: message.threadId, occurredAt: message.occurredAt },
    }).catch(() => {});
    return data;
  } catch (error) {
    await removeStorageFile(DOCUMENT_BUCKET, storageKey).catch(() => {});
    throw error;
  }
}
