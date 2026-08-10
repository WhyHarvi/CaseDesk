import { randomUUID } from "node:crypto";
import path from "node:path";
import prisma from "../services/prisma/client.js";
import { removeDocumentFile, requireDocumentFile, writeDocumentFile } from "../services/documentStorage.js";
import { createHttpError } from "../utils/http.js";
import { createCrudController, fieldParsers, recordActivity } from "../utils/prismaCrud.js";
import { normalizeDocumentName } from "../utils/documentNames.js";
import { relatedRecordAccessWhere } from "../middleware/authorization.js";

const include = {
  client: {
    select: {
      id: true,
      fullName: true,
    },
  },
  case: {
    select: {
      id: true,
      caseType: true,
      stage: true,
    },
  },
  uploadedBy: {
    select: {
      id: true,
      fullName: true,
    },
  },
  reviewedBy: {
    select: {
      id: true,
      fullName: true,
    },
  },
  writtenDocument: {
    select: {
      id: true,
      title: true,
      status: true,
      correspondenceStatus: true,
      updatedAt: true,
    },
  },
  folder: {
    select: {
      id: true,
      name: true,
    },
  },
};

const commonFields = {
  clientId: fieldParsers.relationField,
  caseId: fieldParsers.relationField,
  documentName: fieldParsers.stringField,
  normalizedName: fieldParsers.stringField,
  notes: fieldParsers.stringField,
  clientInstructions: fieldParsers.stringField,
  receivedAt: fieldParsers.dateField,
  dueAt: fieldParsers.dateField,
  visibility: fieldParsers.enumField(["Client", "Internal"]),
  folderId: fieldParsers.relationField,
};

const createFields = {
  ...commonFields,
  status: fieldParsers.enumField(["Requested"]),
};

const controller = createCrudController({
  model: "clientDocument",
  label: "Client document",
  createFields,
  updateFields: commonFields,
  include,
  buildAccessWhere: relatedRecordAccessWhere,
  buildListWhere: (req) => ({
    ...(req.query.clientId ? { clientId: req.query.clientId } : {}),
    ...(req.query.caseId ? { caseId: req.query.caseId } : {}),
    ...(req.query.status ? { status: req.query.status } : {}),
  }),
  activityEntity: "client_document",
});

export const listClientDocuments = controller.list;
export const getClientDocumentById = controller.getById;
function duplicateDocumentError(error) {
  return error?.code === "P2002"
    ? createHttpError(409, "This document requirement is already assigned to the case")
    : error;
}

export async function createClientDocument(req, res) {
  const visibility = req.body.visibility === "Internal" ? "Internal" : "Client";
  req.body.status = "Requested";
  req.body.normalizedName = visibility === "Client" ? normalizeDocumentName(req.body.documentName) : null;
  try {
    await controller.create(req, res);
  } catch (error) {
    throw duplicateDocumentError(error);
  }
}

export async function updateClientDocument(req, res) {
  const existing = await prisma.clientDocument.findFirst({
    where: { id: req.params.id, agencyId: req.user.agencyId },
    select: { documentName: true, visibility: true, caseId: true },
  });
  if (!existing) throw createHttpError(404, "Client document not found");
  const visibility = req.body.visibility || existing.visibility;
  const documentName = req.body.documentName ?? existing.documentName;
  req.body.normalizedName = visibility === "Client" ? normalizeDocumentName(documentName) : null;
  // Folders only organize a consultant's own internal working files — a
  // client-requested document stays flat under its checklist item.
  if (Object.hasOwn(req.body, "folderId") && req.body.folderId) {
    if (visibility !== "Internal") throw createHttpError(400, "Only internal working files can be filed into a folder", "VALIDATION_ERROR");
    const folder = await prisma.documentFolder.findFirst({
      where: { id: req.body.folderId, agencyId: req.user.agencyId, caseId: existing.caseId },
      select: { id: true },
    });
    if (!folder) throw createHttpError(404, "Folder not found");
  }
  try {
    await controller.update(req, res);
  } catch (error) {
    throw duplicateDocumentError(error);
  }
}

export async function uploadClientDocumentFile(req, res) {
  if (!req.file) {
    throw createHttpError(400, "A document file is required");
  }

  const documentId = String(req.body.documentId || "").trim();
  const caseId = String(req.body.caseId || "").trim();
  const clientId = String(req.body.clientId || "").trim();
  let existing = null;
  let targetCase = null;

  if (documentId) {
    existing = await prisma.clientDocument.findFirst({
      where: { id: documentId, agencyId: req.user.agencyId },
    });
    if (!existing) throw createHttpError(404, "Case document not found");
  } else {
    if (!caseId || !clientId) throw createHttpError(400, "caseId and clientId are required");
    targetCase = await prisma.case.findFirst({
      where: { id: caseId, clientId, agencyId: req.user.agencyId },
      select: { id: true, clientId: true },
    });
    if (!targetCase) throw createHttpError(404, "Case not found");
  }

  const destinationCaseId = existing?.caseId || targetCase?.id;
  const destinationClientId = existing?.clientId || targetCase?.clientId;
  const extension = path.extname(req.file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 12);
  const storageKey = path.posix.join(req.user.agencyId, destinationCaseId || `client-${destinationClientId}`, `${randomUUID()}${extension}`);
  await writeDocumentFile(storageKey, req.file.buffer, req.file.mimetype);

  let folderId = String(req.body.folderId || "").trim() || null;
  if (folderId && !existing) {
    const folder = await prisma.documentFolder.findFirst({
      where: { id: folderId, agencyId: req.user.agencyId, caseId: destinationCaseId },
      select: { id: true },
    });
    if (!folder) throw createHttpError(404, "Folder not found");
  } else if (existing) {
    folderId = null; // re-uploading a file onto an existing document never moves it between folders here
  }

  let committed = false;
  try {
    const documentName = String(req.body.documentName || req.file.originalname).trim();
    const visibility = req.body.visibility === "Internal" ? "Internal" : "Client";
    const fileData = {
      storageKey,
      originalFilename: req.file.originalname,
      mimeType: req.file.mimetype,
      fileSize: req.file.size,
      status: "Uploaded",
      receivedAt: new Date(),
      reviewedAt: null,
    };
    const data = existing
      ? await prisma.clientDocument.update({
          where: { id: existing.id },
          data: {
            ...fileData,
            uploadedBy: { connect: { id: req.user.id } },
            reviewedBy: { disconnect: true },
          },
          include,
        })
      : await prisma.clientDocument.create({
          data: {
            documentName,
            normalizedName: visibility === "Client" ? normalizeDocumentName(documentName) : null,
            visibility,
            notes: req.body.visibility === "Internal" ? "Internal staff document" : null,
            agency: { connect: { id: req.user.agencyId } },
            client: { connect: { id: destinationClientId } },
            ...(destinationCaseId ? { case: { connect: { id: destinationCaseId } } } : {}),
            ...(folderId ? { folder: { connect: { id: folderId } } } : {}),
            uploadedBy: { connect: { id: req.user.id } },
            ...fileData,
          },
          include,
        });

    committed = true;
    if (existing?.storageKey && existing.storageKey !== storageKey) {
      await removeDocumentFile(existing.storageKey).catch(() => {});
    }

    await recordActivity({
      agencyId: req.user.agencyId,
      userId: req.user.id,
      clientId: destinationClientId,
      caseId: destinationCaseId,
      entityType: "client_document",
      entityId: data.id,
      action: existing ? "client_document.file_replaced" : "client_document.file_uploaded",
      details: `${req.file.originalname} uploaded`,
    });

    res.status(existing ? 200 : 201).json({ data });
  } catch (error) {
    if (!committed) await removeDocumentFile(storageKey);
    throw error;
  }
}

export async function serveClientDocumentFile(req, res) {
  const data = await prisma.clientDocument.findFirst({
    where: { id: req.params.id, agencyId: req.user.agencyId },
    select: { storageKey: true, originalFilename: true, mimeType: true },
  });

  if (!data?.storageKey) throw createHttpError(404, "No uploaded file is available for this document");
  const buffer = await requireDocumentFile(data.storageKey);

  const disposition = req.query.download === "1" ? "attachment" : "inline";
  const filename = encodeURIComponent(data.originalFilename || "document");
  res.setHeader("Content-Disposition", `${disposition}; filename*=UTF-8''${filename}`);
  res.type(data.mimeType || "application/octet-stream");
  res.send(buffer);
}

export async function finalizeClientDocument(req, res) {
  if (!["admin", "staff"].includes(req.user.role)) {
    throw createHttpError(403, "You do not have permission to finalize documents");
  }

  const existing = await prisma.clientDocument.findFirst({
    where: { id: req.params.id, agencyId: req.user.agencyId },
  });

  if (!existing) throw createHttpError(404, "Client document not found");
  if (existing.status === "Finalized") throw createHttpError(409, "This document is already finalized");
  if (!existing.storageKey) throw createHttpError(409, "Upload a file before finalizing this document");

  try {
    await requireDocumentFile(existing.storageKey);
  } catch {
    throw createHttpError(409, "The stored file is unavailable and cannot be finalized");
  }

  const data = await prisma.$transaction(async (tx) => {
    const updateResult = await tx.clientDocument.updateMany({
      where: {
        id: existing.id,
        agencyId: req.user.agencyId,
        status: { not: "Finalized" },
        storageKey: { not: null },
      },
      data: {
        status: "Finalized",
        reviewedAt: new Date(),
      },
    });

    if (updateResult.count !== 1) {
      throw createHttpError(409, "This document was finalized by another user");
    }

    return tx.clientDocument.update({
      where: { id: existing.id },
      data: { reviewedBy: { connect: { id: req.user.id } } },
      include,
    });
  });

  await recordActivity({
    agencyId: req.user.agencyId,
    userId: req.user.id,
    clientId: existing.clientId,
    caseId: existing.caseId,
    action: "client_document.finalized",
    details: `${existing.documentName} finalized by ${req.user.fullName}`,
  });

  res.json({ data });
}

const documentStatuses = new Set(["Requested", "Uploaded", "UnderReview", "ChangesRequested", "Approved", "Finalized", "NotRequired"]);
const fileRequiredStatuses = new Set(["Uploaded", "UnderReview", "ChangesRequested", "Approved", "Finalized"]);

export async function updateClientDocumentStatus(req, res) {
  const status = req.body.status;
  if (!documentStatuses.has(status)) throw createHttpError(400, "Invalid document status");
  if (status === "Finalized") return finalizeClientDocument(req, res);
  if (!["admin", "staff"].includes(req.user.role)) throw createHttpError(403, "You do not have permission to update document status");

  const existing = await prisma.clientDocument.findFirst({
    where: { id: req.params.id, agencyId: req.user.agencyId },
  });
  if (!existing) throw createHttpError(404, "Client document not found");
  if (fileRequiredStatuses.has(status) && !existing.storageKey) {
    throw createHttpError(409, "Upload a file before selecting this status");
  }

  const data = await prisma.clientDocument.update({
    where: { id: existing.id },
    data: {
      status,
      ...(status === "Uploaded" && !existing.receivedAt ? { receivedAt: new Date() } : {}),
      ...(existing.status === "Finalized" ? { reviewedAt: null, reviewedBy: { disconnect: true } } : {}),
    },
    include,
  });

  await recordActivity({
    agencyId: req.user.agencyId,
    userId: req.user.id,
    clientId: existing.clientId,
    caseId: existing.caseId,
    action: "client_document.status_changed",
    details: `${existing.documentName} changed from ${existing.status} to ${status} by ${req.user.fullName}`,
  });
  res.json({ data });
}

export async function deleteClientDocument(req, res) {
  const existing = await prisma.clientDocument.findFirst({
    where: { id: req.params.id, agencyId: req.user.agencyId },
  });
  if (!existing) throw createHttpError(404, "Client document not found");

  await prisma.clientDocument.delete({ where: { id: existing.id } });
  await removeDocumentFile(existing.storageKey);
  await recordActivity({
    agencyId: req.user.agencyId,
    userId: req.user.id,
    clientId: existing.clientId,
    caseId: existing.caseId,
    action: "client_document.deleted",
    details: `${existing.documentName} deleted`,
  });
  res.status(204).send();
}

export default controller;
