import prisma from "../services/prisma/client.js";
import { caseAccessWhere, caseLinkedRecordAccessWhere } from "../middleware/authorization.js";
import { createHttpError } from "../utils/http.js";

// Folders only organize a consultant's own internal working files on a case
// (see ClientDocument.folderId) — flat, single level, scoped to one case.
// Client-requested documents never live in a folder.

async function requireCase(req, caseId) {
  const targetCase = await prisma.case.findFirst({
    where: {
      id: caseId,
      agencyId: req.user.agencyId,
      ...caseAccessWhere(req),
    },
    select: { id: true },
  });
  if (!targetCase) throw createHttpError(404, "Case not found");
  return targetCase;
}

function duplicateFolderNameError(error) {
  return error?.code === "P2002"
    ? createHttpError(409, "A folder with this name already exists on this case", "DUPLICATE_NAME")
    : error;
}

export async function listDocumentFolders(req, res) {
  const caseId = String(req.query.caseId || "").trim();
  if (!caseId) throw createHttpError(400, "caseId is required", "VALIDATION_ERROR");
  await requireCase(req, caseId);
  const folders = await prisma.documentFolder.findMany({
    where: { agencyId: req.user.agencyId, caseId },
    include: { _count: { select: { documents: true } } },
    orderBy: { name: "asc" },
  });
  res.json({ data: folders.map(({ _count, ...folder }) => ({ ...folder, documentCount: _count.documents })) });
}

export async function createDocumentFolder(req, res) {
  const caseId = String(req.body.caseId || "").trim();
  const name = String(req.body.name || "").trim().slice(0, 120);
  if (!name) throw createHttpError(400, "Folder name is required", "VALIDATION_ERROR");
  await requireCase(req, caseId);
  try {
    const folder = await prisma.documentFolder.create({
      data: { agencyId: req.user.agencyId, caseId, name, createdById: req.user.id },
    });
    res.status(201).json({ data: { ...folder, documentCount: 0 } });
  } catch (error) {
    throw duplicateFolderNameError(error);
  }
}

export async function renameDocumentFolder(req, res) {
  const name = String(req.body.name || "").trim().slice(0, 120);
  if (!name) throw createHttpError(400, "Folder name is required", "VALIDATION_ERROR");
  const existing = await prisma.documentFolder.findFirst({
    where: {
      id: req.params.id,
      agencyId: req.user.agencyId,
      ...caseLinkedRecordAccessWhere(req),
    },
  });
  if (!existing) throw createHttpError(404, "Folder not found");
  try {
    const folder = await prisma.documentFolder.update({ where: { id: existing.id }, data: { name } });
    res.json({ data: folder });
  } catch (error) {
    throw duplicateFolderNameError(error);
  }
}

export async function deleteDocumentFolder(req, res) {
  const existing = await prisma.documentFolder.findFirst({
    where: {
      id: req.params.id,
      agencyId: req.user.agencyId,
      ...caseLinkedRecordAccessWhere(req),
    },
    include: { _count: { select: { documents: true } } },
  });
  if (!existing) throw createHttpError(404, "Folder not found");
  if (existing._count.documents > 0) {
    throw createHttpError(409, "Move or delete the files inside this folder first.", "FOLDER_NOT_EMPTY");
  }
  await prisma.documentFolder.delete({ where: { id: existing.id } });
  res.json({ data: { id: existing.id } });
}
