import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import prisma from "./prisma/client.js";
import { DOCUMENT_BUCKET, removeStorageFile, uploadStorageFile } from "./supabaseStorage.js";
import { recordCommunicationAudit } from "./communicationAudit.js";
import { broadcastCaseCommunication } from "./supabaseRealtimeService.js";

export const inboundAllowedMimeTypes = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "text/plain",
  "text/rtf",
  "application/rtf",
  "text/csv",
]);

export function extensionOf(filename) {
  return path
    .extname(String(filename || ""))
    .toLowerCase()
    .replace(/[^.a-z0-9]/g, "")
    .slice(0, 12);
}

export async function scanFile(file) {
  const scannerUrl = String(process.env.COMMUNICATION_FILE_SCAN_URL || "").trim();
  if (!scannerUrl) {
    return process.env.NODE_ENV === "production"
      ? { status: "Pending", details: "External malware scanning is not configured" }
      : { status: "Clean", details: "Development mode: validated file type and size" };
  }
  try {
    const form = new FormData();
    form.append("file", new Blob([file.buffer], { type: file.mimetype }), file.originalname);
    const response = await fetch(scannerUrl, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(30000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.clean !== true)
      return {
        status: "Rejected",
        details: String(result.message || "Security scanner rejected this file").slice(0, 500),
      };
    return {
      status: "Clean",
      details: String(result.message || "Malware scan passed").slice(0, 500),
    };
  } catch (error) {
    return {
      status: "Pending",
      details: `Malware scan unavailable: ${String(error.message || error).slice(0, 400)}`,
    };
  }
}

// The shared upload+scan+record+audit path for attaching a file to an
// existing CommunicationMessage — used by the staff, authenticated-portal,
// and token-link chat attachment endpoints so none of the three duplicate
// the storage-write/cleanup-on-failure logic independently.
export async function storeCommunicationAttachment({ agencyId, message, file, uploadedById, auditUserId }) {
  const storageKey = path.posix.join(
    agencyId,
    message.caseId || "general",
    "communication",
    `${randomUUID()}${extensionOf(file.originalname)}`,
  );
  await uploadStorageFile(DOCUMENT_BUCKET, storageKey, file.buffer, file.mimetype);
  try {
    const scan = await scanFile(file);
    const data = await prisma.communicationAttachment.create({
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
    await recordCommunicationAudit({
      agencyId,
      userId: auditUserId,
      conversationId: message.conversationId,
      messageId: message.id,
      action: "communication.attachment_uploaded",
      details: `${file.originalname} attached`,
      metadata: { attachmentId: data.id, scanStatus: data.scanStatus },
    });
    // For an attachment-only chat message, this is the broadcast that was
    // deferred at message-creation time — recipients now see a fully
    // formed bubble instead of an empty one that fills in a moment later.
    if (message.channel === "Chat" && message.caseId) {
      await broadcastCaseCommunication({
        agencyId,
        caseId: message.caseId,
        event: "message",
        payload: {
          messageId: message.id,
          conversationId: message.conversationId,
          occurredAt: message.occurredAt,
        },
      }).catch(() => {});
    }
    return data;
  } catch (error) {
    await removeStorageFile(DOCUMENT_BUCKET, storageKey).catch(() => {});
    throw error;
  }
}

// A chat message never passes through "Draft" — it's created already
// "Sent"/"Received" — so each chat surface needs its own allowance to
// attach a file to a message just created there, within a short grace
// window (the normal "pick an image, it uploads a moment after the
// message shell is created" flow). Own-message scoping differs per
// surface (a real senderUserId for staff/portal, no user at all for the
// anonymous token-link flow), so callers do that check themselves and use
// this just for the shared time window.
export const CHAT_ATTACH_GRACE_MS = 5 * 60_000;
