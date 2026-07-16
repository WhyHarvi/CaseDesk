import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";

const versionInclude = {
  createdBy: { select: { id: true, fullName: true } },
};

const include = {
  clientDocument: { select: { id: true, documentName: true, originalFilename: true, updatedAt: true } },
  createdBy: { select: { id: true, fullName: true } },
  updatedBy: { select: { id: true, fullName: true } },
  issuedBy: { select: { id: true, fullName: true } },
  correspondenceTemplate: { select: { id: true, title: true, kind: true, category: true, versionNumber: true } },
  versions: { include: versionInclude, orderBy: { versionNumber: "desc" }, take: 30 },
};

function cleanText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function contentPayload(body) {
  const contentHtml = String(body.contentHtml ?? "");
  if (contentHtml.length > 2_000_000) throw createHttpError(413, "Written document content is too large");
  return {
    title: cleanText(body.title, "Untitled Document").slice(0, 200) || "Untitled Document",
    contentHtml,
    headerText: cleanText(body.headerText).slice(0, 500) || null,
    footerText: cleanText(body.footerText).slice(0, 500) || null,
    showPageNumbers: body.showPageNumbers !== false,
  };
}

async function findWrittenDocument(req) {
  const data = await prisma.writtenDocument.findFirst({
    where: { id: req.params.id, agencyId: req.user.agencyId },
    include,
  });
  if (!data) throw createHttpError(404, "Written document not found");
  return data;
}

function requireEditableDocument(document) {
  if (["Issued", "Signed", "Finalized"].includes(document.correspondenceStatus)) {
    throw createHttpError(409, "Issued and signed documents are locked. Create a new draft to make changes");
  }
}

export async function createWrittenDocument(req, res) {
  const caseItem = await prisma.case.findFirst({
    where: { id: req.body.caseId, agencyId: req.user.agencyId },
    select: { id: true, clientId: true },
  });
  if (!caseItem) throw createHttpError(404, "Case not found");
  const payload = contentPayload(req.body);
  const data = await prisma.writtenDocument.create({
    data: {
      agency: { connect: { id: req.user.agencyId } },
      client: { connect: { id: caseItem.clientId } },
      case: { connect: { id: caseItem.id } },
      createdBy: { connect: { id: req.user.id } },
      updatedBy: { connect: { id: req.user.id } },
      status: "Draft",
      ...payload,
    },
    include,
  });
  await recordActivity({ agencyId: req.user.agencyId, userId: req.user.id, clientId: caseItem.clientId, caseId: caseItem.id, action: "written_document.draft_created", details: `${data.title} draft created` });
  res.status(201).json({ data });
}

export async function listWrittenDocuments(req, res) {
  const data = await prisma.writtenDocument.findMany({
    where: {
      agencyId: req.user.agencyId,
      ...(req.query.caseId ? { caseId: req.query.caseId } : {}),
    },
    include: {
      clientDocument: { select: { id: true, documentName: true, originalFilename: true, updatedAt: true } },
      updatedBy: { select: { id: true, fullName: true } },
      _count: { select: { versions: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  res.json({ data });
}

export async function getWrittenDocument(req, res) {
  res.json({ data: await findWrittenDocument(req) });
}

export async function updateWrittenDocumentDraft(req, res) {
  const existing = await findWrittenDocument(req);
  requireEditableDocument(existing);
  const data = await prisma.writtenDocument.update({
    where: { id: existing.id },
    data: { ...contentPayload(req.body), status: "Draft", updatedBy: { connect: { id: req.user.id } } },
    include,
  });
  res.json({ data });
}

export async function saveWrittenDocumentVersion(req, res) {
  const existing = await findWrittenDocument(req);
  requireEditableDocument(existing);
  const clientDocument = await prisma.clientDocument.findFirst({
    where: { id: req.body.clientDocumentId, agencyId: req.user.agencyId, caseId: existing.caseId, visibility: "Internal", storageKey: { not: null } },
  });
  if (!clientDocument) throw createHttpError(409, "Save the Word file before creating a document version");
  const payload = contentPayload(req.body);

  const data = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${existing.id}))::text AS lock_status`;
    const latest = await tx.writtenDocumentVersion.aggregate({ where: { writtenDocumentId: existing.id }, _max: { versionNumber: true } });
    const versionNumber = (latest._max.versionNumber || 0) + 1;
    await tx.writtenDocumentVersion.create({
      data: {
        versionNumber,
        clientDocumentId: clientDocument.id,
        agency: { connect: { id: req.user.agencyId } },
        writtenDocument: { connect: { id: existing.id } },
        createdBy: { connect: { id: req.user.id } },
        ...payload,
      },
    });
    return tx.writtenDocument.update({
      where: { id: existing.id },
      data: { ...payload, status: "Saved", updatedBy: { connect: { id: req.user.id } }, clientDocument: { connect: { id: clientDocument.id } } },
      include,
    });
  });
  await recordActivity({ agencyId: req.user.agencyId, userId: req.user.id, clientId: existing.clientId, caseId: existing.caseId, action: "written_document.version_saved", details: `${data.title} version ${data.versions[0]?.versionNumber || ""} saved` });
  res.json({ data });
}

export async function restoreWrittenDocumentVersion(req, res) {
  const existing = await findWrittenDocument(req);
  requireEditableDocument(existing);
  const version = await prisma.writtenDocumentVersion.findFirst({
    where: { id: req.params.versionId, writtenDocumentId: existing.id, agencyId: req.user.agencyId },
  });
  if (!version) throw createHttpError(404, "Document version not found");
  const data = await prisma.writtenDocument.update({
    where: { id: existing.id },
    data: {
      title: version.title,
      contentHtml: version.contentHtml,
      headerText: version.headerText,
      footerText: version.footerText,
      showPageNumbers: version.showPageNumbers,
      status: "Draft",
      updatedBy: { connect: { id: req.user.id } },
    },
    include,
  });
  await recordActivity({ agencyId: req.user.agencyId, userId: req.user.id, clientId: existing.clientId, caseId: existing.caseId, action: "written_document.version_restored", details: `${existing.title} restored from version ${version.versionNumber}` });
  res.json({ data });
}
