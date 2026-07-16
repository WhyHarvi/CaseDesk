import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import prisma from "../services/prisma/client.js";
import { DOCUMENT_BUCKET, downloadStorageFile, removeStorageFile, uploadStorageFile } from "../services/supabaseStorage.js";
import { recordCommunicationAudit } from "../services/communicationAudit.js";
import { requireCommunicationPermission } from "../services/communicationPermissions.js";
import { createHttpError } from "../utils/http.js";

const inboundAllowedMimeTypes = new Set([
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

function extensionOf(filename) {
  return path
    .extname(String(filename || ""))
    .toLowerCase()
    .replace(/[^.a-z0-9]/g, "")
    .slice(0, 12);
}

async function scanFile(file) {
  const scannerUrl = String(
    process.env.COMMUNICATION_FILE_SCAN_URL || "",
  ).trim();
  if (!scannerUrl) {
    return process.env.NODE_ENV === "production"
      ? {
          status: "Pending",
          details: "External malware scanning is not configured",
        }
      : {
          status: "Clean",
          details: "Development mode: validated file type and size",
        };
  }
  try {
    const form = new FormData();
    form.append(
      "file",
      new Blob([file.buffer], { type: file.mimetype }),
      file.originalname,
    );
    const response = await fetch(scannerUrl, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(30000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.clean !== true)
      return {
        status: "Rejected",
        details: String(
          result.message || "Security scanner rejected this file",
        ).slice(0, 500),
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

export async function storeInboundCommunicationAttachments({
  agencyId,
  messageId,
  uploadedById,
  attachments = [],
}) {
  const message = await prisma.communicationMessage.findFirst({
    where: { id: messageId, agencyId },
    select: { id: true, caseId: true, conversationId: true },
  });
  if (!message) return [];
  const ownerId =
    uploadedById ||
    (
      await prisma.user.findFirst({
        where: { agencyId },
        orderBy: [{ role: "asc" }, { createdAt: "asc" }],
        select: { id: true },
      })
    )?.id;
  if (!ownerId) return [];
  const stored = [];
  for (const attachment of attachments.slice(0, 20)) {
    const buffer = Buffer.isBuffer(attachment.content)
      ? attachment.content
      : null;
    const mimeType = String(
      attachment.contentType || "application/octet-stream",
    ).toLowerCase();
    const originalFilename = String(attachment.filename || "email-attachment")
      .replace(/[\r\n]/g, "")
      .slice(0, 255);
    if (
      !buffer ||
      !buffer.length ||
      buffer.length > 25 * 1024 * 1024 ||
      !inboundAllowedMimeTypes.has(mimeType)
    ) {
      await recordCommunicationAudit({
        agencyId,
        conversationId: message.conversationId,
        messageId,
        action: "communication.inbound_attachment_skipped",
        details: `${originalFilename} was not stored because its type or size is not allowed`,
        metadata: { mimeType, fileSize: buffer?.length || 0 },
      });
      continue;
    }
    const storageKey = path.posix.join(
      agencyId,
      message.caseId,
      "communication",
      `${randomUUID()}${extensionOf(originalFilename)}`,
    );
    await uploadStorageFile(DOCUMENT_BUCKET, storageKey, buffer, mimeType);
    try {
      const scan = await scanFile({
        buffer,
        mimetype: mimeType,
        originalname: originalFilename,
      });
      const record = await prisma.communicationAttachment.create({
        data: {
          agencyId,
          messageId,
          storageKey,
          originalFilename,
          mimeType,
          fileSize: buffer.length,
          fileHash: createHash("sha256").update(buffer).digest("hex"),
          scanStatus: scan.status,
          scanDetails: scan.details,
          uploadedById: ownerId,
        },
      });
      stored.push(record);
      await recordCommunicationAudit({
        agencyId,
        userId: ownerId,
        conversationId: message.conversationId,
        messageId,
        action: "communication.inbound_attachment_stored",
        details: `${originalFilename} received with email`,
        metadata: { attachmentId: record.id, scanStatus: record.scanStatus },
      });
    } catch (error) {
      await removeStorageFile(DOCUMENT_BUCKET, storageKey).catch(() => {});
      throw error;
    }
  }
  return stored;
}

export async function uploadCommunicationAttachment(req, res) {
  if (!req.file) throw createHttpError(400, "Choose a file to attach");
  const message = await prisma.communicationMessage.findFirst({
    where: { id: req.params.id, agencyId: req.user.agencyId, deletedAt: null },
  });
  if (!message) throw createHttpError(404, "Communication draft not found");
  await requireCommunicationPermission(
    req,
    message.channel === "Email"
      ? "canSendEmail"
      : message.channel === "Sms"
        ? "canSendSms"
        : "canUseChat",
  );
  if (!["Draft", "Failed"].includes(message.status))
    throw createHttpError(
      409,
      "Attachments can only be changed while a communication is a draft",
    );
  const storageKey = path.posix.join(
    req.user.agencyId,
    message.caseId,
    "communication",
    `${randomUUID()}${extensionOf(req.file.originalname)}`,
  );
  await uploadStorageFile(DOCUMENT_BUCKET, storageKey, req.file.buffer, req.file.mimetype);
  try {
    const scan = await scanFile(req.file);
    const data = await prisma.communicationAttachment.create({
      data: {
        agencyId: req.user.agencyId,
        messageId: message.id,
        storageKey,
        originalFilename: req.file.originalname,
        mimeType: req.file.mimetype,
        fileSize: req.file.size,
        fileHash: createHash("sha256").update(req.file.buffer).digest("hex"),
        scanStatus: scan.status,
        scanDetails: scan.details,
        uploadedById: req.user.id,
      },
    });
    await recordCommunicationAudit({
      agencyId: req.user.agencyId,
      userId: req.user.id,
      conversationId: message.conversationId,
      messageId: message.id,
      action: "communication.attachment_uploaded",
      details: `${req.file.originalname} attached`,
      metadata: { attachmentId: data.id, scanStatus: data.scanStatus },
    });
    res.status(201).json({ data });
  } catch (error) {
    await removeStorageFile(DOCUMENT_BUCKET, storageKey).catch(() => {});
    throw error;
  }
}

export async function serveCommunicationAttachment(req, res) {
  await requireCommunicationPermission(req, "canView");
  const data = await prisma.communicationAttachment.findFirst({
    where: { id: req.params.attachmentId, agencyId: req.user.agencyId },
    include: { message: { select: { deletedAt: true } } },
  });
  if (!data || data.message.deletedAt)
    throw createHttpError(404, "Communication attachment not found");
  if (data.scanStatus === "Rejected")
    throw createHttpError(
      409,
      "This attachment was rejected by the security scanner",
    );
  const buffer = await downloadStorageFile(DOCUMENT_BUCKET, data.storageKey, { allowMissing: true });
  if (!buffer) throw createHttpError(404, "Stored attachment file was not found");
  res.setHeader("content-type", data.mimeType || "application/octet-stream");
  res.setHeader(
    "content-disposition",
    `inline; filename*=UTF-8''${encodeURIComponent(data.originalFilename)}`,
  );
  res.send(buffer);
}

export async function deleteCommunicationAttachment(req, res) {
  const data = await prisma.communicationAttachment.findFirst({
    where: { id: req.params.attachmentId, agencyId: req.user.agencyId },
    include: { message: true },
  });
  if (!data) throw createHttpError(404, "Communication attachment not found");
  await requireCommunicationPermission(
    req,
    data.message.channel === "Email"
      ? "canSendEmail"
      : data.message.channel === "Sms"
        ? "canSendSms"
        : "canUseChat",
  );
  if (!["Draft", "Failed"].includes(data.message.status))
    throw createHttpError(
      409,
      "Sent communication attachments cannot be removed",
    );
  await prisma.communicationAttachment.delete({ where: { id: data.id } });
  await removeStorageFile(DOCUMENT_BUCKET, data.storageKey).catch(() => {});
  await recordCommunicationAudit({
    agencyId: req.user.agencyId,
    userId: req.user.id,
    conversationId: data.message.conversationId,
    messageId: data.messageId,
    action: "communication.attachment_deleted",
    details: `${data.originalFilename} removed from draft`,
    metadata: { attachmentId: data.id },
  });
  res.status(204).send();
}
