import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import prisma from "../services/prisma/client.js";
import { copyStorageFile, DOCUMENT_BUCKET, downloadStorageFile, removeStorageFile, uploadStorageFile } from "../services/supabaseStorage.js";
import { normalizeDocumentName } from "../utils/documentNames.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { requireFormPermission } from "../services/formPermissions.js";

const include = { uploadedBy: { select: { id: true, fullName: true } }, _count: { select: { versions: true, caseForms: true } } };
const versionInclude = { createdBy: { select: { id: true, fullName: true } } };

function requireManager(req) {
  if (req.user.role !== "admin") throw createHttpError(403, "Only administrators can manage agency form templates");
}

function hashBuffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function extensionOf(filename) {
  return path.extname(filename).toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 12);
}

async function removeFile(storageKey) {
  if (!storageKey) return;
  await removeStorageFile(DOCUMENT_BUCKET, storageKey);
}

function templateData(req, fallback = {}) {
  const title = String(req.body.title ?? fallback.title ?? req.file?.originalname ?? "").trim();
  if (!title) throw createHttpError(400, "Template title is required");
  const formNumber = String(req.body.formNumber ?? fallback.formNumber ?? "").trim() || null;
  return {
    title,
    formNumber,
    normalizedName: normalizeDocumentName([formNumber, title].filter(Boolean).join(" ")),
    category: String(req.body.category ?? fallback.category ?? "General").trim() || "General",
    description: String(req.body.description ?? fallback.description ?? "").trim() || null,
    language: String(req.body.language ?? fallback.language ?? "English").trim() || "English",
    sourceRevision: String(req.body.sourceRevision ?? fallback.sourceRevision ?? "").trim() || null,
  };
}

export async function listAgencyFormTemplates(req, res) {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  const search = String(req.query.search || "").trim();
  const category = String(req.query.category || "").trim();
  const where = { agencyId: req.user.agencyId, ...(category ? { category } : {}), ...(search ? { OR: [{ title: { contains: search, mode: "insensitive" } }, { formNumber: { contains: search, mode: "insensitive" } }, { category: { contains: search, mode: "insensitive" } }] } : {}) };
  const [data, total, categories] = await Promise.all([
    prisma.agencyFormTemplate.findMany({ where, include, orderBy: [{ category: "asc" }, { updatedAt: "desc" }], skip: (page - 1) * limit, take: limit }),
    prisma.agencyFormTemplate.count({ where }),
    prisma.agencyFormTemplate.findMany({ where: { agencyId: req.user.agencyId }, distinct: ["category"], select: { category: true }, orderBy: { category: "asc" } }),
  ]);
  res.json({ data, meta: { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1), categories: categories.map((item) => item.category), canManage: req.user.role === "admin" } });
}

export async function createAgencyFormTemplate(req, res) {
  requireManager(req);
  if (!req.file) throw createHttpError(400, "A template file is required");
  const metadata = templateData(req);
  const storageKey = path.posix.join(req.user.agencyId, "form-templates", `${randomUUID()}${extensionOf(req.file.originalname)}`);
  await uploadStorageFile(DOCUMENT_BUCKET, storageKey, req.file.buffer, req.file.mimetype);
  const fileHash = hashBuffer(req.file.buffer);
  try {
    const data = await prisma.agencyFormTemplate.create({ data: { agencyId: req.user.agencyId, ...metadata, storageKey, originalFilename: req.file.originalname, mimeType: req.file.mimetype, fileSize: req.file.size, fileHash, uploadedById: req.user.id, versions: { create: { agencyId: req.user.agencyId, versionNumber: 1, sourceRevision: metadata.sourceRevision, storageKey, originalFilename: req.file.originalname, mimeType: req.file.mimetype, fileSize: req.file.size, fileHash, createdById: req.user.id } } }, include });
    await recordActivity({ agencyId: req.user.agencyId, userId: req.user.id, action: "agency_form_template.created", details: `${data.title} saved to the agency form library` });
    res.status(201).json({ data });
  } catch (error) { await removeFile(storageKey); if (error.code === "P2002") throw createHttpError(409, "A form template with this name or number already exists"); throw error; }
}

export async function updateAgencyFormTemplate(req, res) {
  requireManager(req);
  const existing = await prisma.agencyFormTemplate.findFirst({ where: { id: req.params.id, agencyId: req.user.agencyId } });
  if (!existing) throw createHttpError(404, "Agency form template not found");
  const metadata = templateData(req, existing);
  try { const data = await prisma.agencyFormTemplate.update({ where: { id: existing.id }, data: metadata, include }); res.json({ data }); } catch (error) { if (error.code === "P2002") throw createHttpError(409, "A form template with this name or number already exists"); throw error; }
}

export async function replaceAgencyFormTemplate(req, res) {
  requireManager(req);
  if (!req.file) throw createHttpError(400, "A replacement template file is required");
  const existing = await prisma.agencyFormTemplate.findFirst({ where: { id: req.params.id, agencyId: req.user.agencyId } });
  if (!existing) throw createHttpError(404, "Agency form template not found");
  const metadata = templateData(req, existing);
  const storageKey = path.posix.join(req.user.agencyId, "form-templates", `${randomUUID()}${extensionOf(req.file.originalname)}`);
  await uploadStorageFile(DOCUMENT_BUCKET, storageKey, req.file.buffer, req.file.mimetype);
  const fileHash = hashBuffer(req.file.buffer);
  try {
    const data = await prisma.$transaction(async (tx) => {
      const versionNumber = existing.currentVersion + 1;
      await tx.agencyFormTemplateVersion.create({ data: { agencyId: req.user.agencyId, agencyFormTemplateId: existing.id, versionNumber, sourceRevision: metadata.sourceRevision, storageKey, originalFilename: req.file.originalname, mimeType: req.file.mimetype, fileSize: req.file.size, fileHash, createdById: req.user.id } });
      return tx.agencyFormTemplate.update({ where: { id: existing.id }, data: { ...metadata, storageKey, originalFilename: req.file.originalname, mimeType: req.file.mimetype, fileSize: req.file.size, fileHash, currentVersion: versionNumber, uploadedById: req.user.id }, include });
    });
    await recordActivity({ agencyId: req.user.agencyId, userId: req.user.id, action: "agency_form_template.replaced", details: `${data.title} updated to template version ${data.currentVersion}` });
    res.json({ data });
  } catch (error) { await removeFile(storageKey); throw error; }
}

export async function listAgencyFormTemplateVersions(req, res) {
  const template = await prisma.agencyFormTemplate.findFirst({ where: { id: req.params.id, agencyId: req.user.agencyId }, select: { id: true } });
  if (!template) throw createHttpError(404, "Agency form template not found");
  const data = await prisma.agencyFormTemplateVersion.findMany({ where: { agencyFormTemplateId: template.id }, include: versionInclude, orderBy: { versionNumber: "desc" } });
  res.json({ data });
}

export async function serveAgencyFormTemplate(req, res) {
  const data = req.params.versionId
    ? await prisma.agencyFormTemplateVersion.findFirst({ where: { id: req.params.versionId, agencyFormTemplateId: req.params.id, agencyId: req.user.agencyId } })
    : await prisma.agencyFormTemplate.findFirst({ where: { id: req.params.id, agencyId: req.user.agencyId } });
  if (!data) throw createHttpError(404, "Agency form template file not found");
  const buffer = await downloadStorageFile(DOCUMENT_BUCKET, data.storageKey, { allowMissing: true });
  if (!buffer) throw createHttpError(404, "Stored agency form template file was not found");
  res.setHeader("Content-Disposition", `${req.query.download === "1" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(data.originalFilename)}`);
  res.type(data.mimeType);
  res.send(buffer);
}

export async function addAgencyFormTemplateToCase(req, res) {
  await requireFormPermission(req, "canAssign");
  const [template, caseItem] = await Promise.all([
    prisma.agencyFormTemplate.findFirst({ where: { id: req.params.id, agencyId: req.user.agencyId } }),
    prisma.case.findFirst({ where: { id: String(req.body.caseId || ""), agencyId: req.user.agencyId }, select: { id: true, clientId: true } }),
  ]);
  if (!template) throw createHttpError(404, "Agency form template not found");
  if (!caseItem) throw createHttpError(404, "Case not found");
  const requirement = ["Required", "Conditional", "Optional"].includes(req.body.requirement) ? req.body.requirement : "Required";
  const storageKey = path.posix.join(req.user.agencyId, caseItem.id, "forms", `${randomUUID()}${extensionOf(template.originalFilename)}`);
  await copyStorageFile(DOCUMENT_BUCKET, template.storageKey, storageKey);
  try {
    const data = await prisma.caseForm.create({ data: { agencyId: req.user.agencyId, clientId: caseItem.clientId, caseId: caseItem.id, sourceAgencyFormTemplateId: template.id, formNumber: template.formNumber, title: template.title, normalizedName: template.normalizedName, source: "Custom", requirement, selectionReason: `Added from agency form library: ${template.title}`, language: template.language, sourceRevision: template.sourceRevision, fileHash: template.fileHash, versionStatus: "Current", currentCopyType: "Original", status: "Assigned", storageKey, originalFilename: template.originalFilename, mimeType: template.mimeType, fileSize: template.fileSize, uploadedById: req.user.id, versions: { create: { agencyId: req.user.agencyId, versionNumber: 1, source: "CustomUpload", copyType: "Original", language: template.language, sourceRevision: template.sourceRevision, fileHash: template.fileHash, storageKey, originalFilename: template.originalFilename, mimeType: template.mimeType, fileSize: template.fileSize, createdById: req.user.id } } }, include: { uploadedBy: { select: { id: true, fullName: true } }, _count: { select: { versions: true, reviewComments: true } } } });
    await recordActivity({ agencyId: req.user.agencyId, userId: req.user.id, clientId: caseItem.clientId, caseId: caseItem.id, action: "agency_form_template.added_to_case", details: `${template.title} copied from the agency form library` });
    res.status(201).json({ data });
  } catch (error) { await removeFile(storageKey); if (error.code === "P2002") throw createHttpError(409, "This form is already assigned to the case"); throw error; }
}

export async function saveCaseFormAsAgencyTemplate(req, res) {
  requireManager(req);
  const form = await prisma.caseForm.findFirst({ where: { id: req.params.caseFormId, agencyId: req.user.agencyId } });
  if (!form) throw createHttpError(404, "Case form not found");
  if (!form.storageKey) throw createHttpError(409, "Save or upload a form copy before creating a template");
  const buffer = await downloadStorageFile(DOCUMENT_BUCKET, form.storageKey);
  req.file = { originalname: form.originalFilename || `${form.title}.pdf`, mimetype: form.mimeType || "application/octet-stream", size: buffer.length, buffer };
  req.body = { ...req.body, title: req.body.title || form.title, formNumber: req.body.formNumber ?? form.formNumber, language: req.body.language || form.language, sourceRevision: req.body.sourceRevision ?? form.sourceRevision };
  return createAgencyFormTemplate(req, res);
}

export async function deleteAgencyFormTemplate(req, res) {
  requireManager(req);
  const existing = await prisma.agencyFormTemplate.findFirst({ where: { id: req.params.id, agencyId: req.user.agencyId }, include: { versions: { select: { storageKey: true } }, _count: { select: { caseForms: true } } } });
  if (!existing) throw createHttpError(404, "Agency form template not found");
  if (existing._count.caseForms) throw createHttpError(409, `This template is used by ${existing._count.caseForms} case form${existing._count.caseForms === 1 ? "" : "s"} and cannot be deleted`);
  await prisma.agencyFormTemplate.delete({ where: { id: existing.id } });
  await Promise.all([...new Set(existing.versions.map((item) => item.storageKey))].map(removeFile));
  await recordActivity({ agencyId: req.user.agencyId, userId: req.user.id, action: "agency_form_template.deleted", details: `${existing.title} removed from the agency form library` });
  res.status(204).send();
}
