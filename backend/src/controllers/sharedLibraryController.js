import { randomUUID } from "node:crypto";
import path from "node:path";
import prisma from "../services/prisma/client.js";
import { copyStorageFile, DOCUMENT_BUCKET, downloadStorageFile, removeStorageFile, uploadStorageFile } from "../services/supabaseStorage.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { normalizeDocumentName } from "../utils/documentNames.js";

const include = { uploadedBy: { select: { id: true, fullName: true } }, _count: { select: { clientDocuments: true } } };

function requireLibraryManager(req) {
  if (req.user.role !== "admin") throw createHttpError(403, "Only administrators can manage the shared library");
}

async function removeFile(storageKey) {
  if (storageKey) await removeStorageFile(DOCUMENT_BUCKET, storageKey);
}

export async function listSharedLibraryDocuments(req, res) {
  const data = await prisma.sharedLibraryDocument.findMany({ where: { agencyId: req.user.agencyId }, include, orderBy: [{ category: "asc" }, { updatedAt: "desc" }] });
  res.json({ data, meta: { canManage: req.user.role === "admin" } });
}

export async function uploadSharedLibraryDocument(req, res) {
  requireLibraryManager(req);
  if (!req.file) throw createHttpError(400, "A shared-library file is required");
  const extension = path.extname(req.file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 12);
  const storageKey = path.posix.join(req.user.agencyId, "shared-library", `${randomUUID()}${extension}`);
  await uploadStorageFile(DOCUMENT_BUCKET, storageKey, req.file.buffer, req.file.mimetype);
  try {
    const data = await prisma.sharedLibraryDocument.create({ data: { agencyId: req.user.agencyId, uploadedById: req.user.id, title: String(req.body.title || req.file.originalname).trim(), category: String(req.body.category || "General").trim(), description: String(req.body.description || "").trim() || null, storageKey, originalFilename: req.file.originalname, mimeType: req.file.mimetype, fileSize: req.file.size }, include });
    await recordActivity({ agencyId: req.user.agencyId, userId: req.user.id, action: "shared_library_document.uploaded", details: `${data.title} added to the shared library` });
    res.status(201).json({ data });
  } catch (error) { await removeFile(storageKey); throw error; }
}

export async function updateSharedLibraryDocument(req, res) {
  requireLibraryManager(req);
  const existing = await prisma.sharedLibraryDocument.findFirst({ where: { id: req.params.id, agencyId: req.user.agencyId } });
  if (!existing) throw createHttpError(404, "Shared-library document not found");
  const data = await prisma.sharedLibraryDocument.update({ where: { id: existing.id }, data: { ...(req.body.title !== undefined ? { title: String(req.body.title).trim() } : {}), ...(req.body.category !== undefined ? { category: String(req.body.category).trim() || "General" } : {}), ...(req.body.description !== undefined ? { description: String(req.body.description).trim() || null } : {}) }, include });
  res.json({ data });
}

export async function serveSharedLibraryDocument(req, res) {
  const data = await prisma.sharedLibraryDocument.findFirst({ where: { id: req.params.id, agencyId: req.user.agencyId } });
  if (!data) throw createHttpError(404, "Shared-library document not found");
  const buffer = await downloadStorageFile(DOCUMENT_BUCKET, data.storageKey, { allowMissing: true });
  if (!buffer) throw createHttpError(404, "Stored shared-library file was not found");
  const disposition = req.query.download === "1" ? "attachment" : "inline";
  res.setHeader("Content-Disposition", `${disposition}; filename*=UTF-8''${encodeURIComponent(data.originalFilename)}`);
  res.type(data.mimeType);
  res.send(buffer);
}

export async function deleteSharedLibraryDocument(req, res) {
  requireLibraryManager(req);
  const existing = await prisma.sharedLibraryDocument.findFirst({ where: { id: req.params.id, agencyId: req.user.agencyId }, include: { _count: { select: { clientDocuments: true } } } });
  if (!existing) throw createHttpError(404, "Shared-library document not found");
  if (existing._count.clientDocuments > 0) throw createHttpError(409, `This resource is used by ${existing._count.clientDocuments} case document${existing._count.clientDocuments === 1 ? "" : "s"} and cannot be deleted`);
  await prisma.sharedLibraryDocument.delete({ where: { id: existing.id } });
  await removeFile(existing.storageKey);
  await recordActivity({ agencyId: req.user.agencyId, userId: req.user.id, action: "shared_library_document.deleted", details: `${existing.title} removed from the shared library` });
  res.status(204).send();
}

export async function addSharedLibraryDocumentToCase(req, res) {
  const mode = req.body.mode;
  if (!["MyDocuments", "ClientRequirement"].includes(mode)) throw createHttpError(400, "mode must be MyDocuments or ClientRequirement");
  const [resource, caseItem] = await Promise.all([
    prisma.sharedLibraryDocument.findFirst({ where: { id: req.params.id, agencyId: req.user.agencyId } }),
    prisma.case.findFirst({ where: { id: req.body.caseId, agencyId: req.user.agencyId }, select: { id: true, clientId: true } }),
  ]);
  if (!resource) throw createHttpError(404, "Shared-library document not found");
  if (!caseItem) throw createHttpError(404, "Case not found");

  let copiedStorageKey = null;
  try {
    const data = await prisma.$transaction(async (tx) => {
      if (mode === "ClientRequirement") {
        return tx.clientDocument.create({
          data: {
            documentName: resource.title,
            normalizedName: normalizeDocumentName(resource.title),
            status: "Requested",
            visibility: "Client",
            notes: `Created from Shared Library: ${resource.title}`,
            agency: { connect: { id: req.user.agencyId } },
            client: { connect: { id: caseItem.clientId } },
            case: { connect: { id: caseItem.id } },
            sourceSharedLibraryDocument: { connect: { id: resource.id } },
          },
        });
      }

      const extension = path.extname(resource.originalFilename).toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 12);
      copiedStorageKey = path.posix.join(req.user.agencyId, caseItem.id, `${randomUUID()}${extension}`);
      await copyStorageFile(DOCUMENT_BUCKET, resource.storageKey, copiedStorageKey);
      return tx.clientDocument.create({
        data: {
          documentName: resource.title,
          status: "Uploaded",
          visibility: "Internal",
          notes: `Copied from Shared Library: ${resource.title}`,
          storageKey: copiedStorageKey,
          originalFilename: resource.originalFilename,
          mimeType: resource.mimeType,
          fileSize: resource.fileSize,
          receivedAt: new Date(),
          agency: { connect: { id: req.user.agencyId } },
          client: { connect: { id: caseItem.clientId } },
          case: { connect: { id: caseItem.id } },
          uploadedBy: { connect: { id: req.user.id } },
          sourceSharedLibraryDocument: { connect: { id: resource.id } },
        },
      });
    });
    await recordActivity({ agencyId: req.user.agencyId, userId: req.user.id, clientId: caseItem.clientId, caseId: caseItem.id, action: mode === "MyDocuments" ? "shared_library_document.copied_to_case" : "shared_library_document.added_as_requirement", details: `${resource.title} added from Shared Library` });
    res.status(201).json({ data });
  } catch (error) {
    if (copiedStorageKey) await removeFile(copiedStorageKey);
    if (error?.code === "P2002") throw createHttpError(409, "This document requirement is already assigned to the case");
    throw error;
  }
}
