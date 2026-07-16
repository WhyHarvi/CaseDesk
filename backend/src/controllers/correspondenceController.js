import { randomUUID } from "node:crypto";
import path from "node:path";
import prisma from "../services/prisma/client.js";
import { copyStorageFile, DOCUMENT_BUCKET, removeStorageFile } from "../services/supabaseStorage.js";
import { ensureDefaultCorrespondenceTemplates, getCorrespondenceContext, renderCorrespondenceHtml, templateMatchesCase } from "../services/correspondenceTemplateService.js";
import { createHttpError } from "../utils/http.js";
import { normalizeDocumentName } from "../utils/documentNames.js";
import { recordActivity } from "../utils/prismaCrud.js";

const templateInclude = { createdBy: { select: { id: true, fullName: true } }, updatedBy: { select: { id: true, fullName: true } }, _count: { select: { versions: true, writtenDocuments: true } } };
const documentInclude = { correspondenceTemplate: { select: { id: true, title: true, kind: true, category: true, versionNumber: true } }, clientDocument: { select: { id: true, documentName: true, originalFilename: true, storageKey: true, updatedAt: true } }, issuedClientDocument: { select: { id: true, documentName: true, originalFilename: true, storageKey: true, updatedAt: true } }, updatedBy: { select: { id: true, fullName: true } }, issuedBy: { select: { id: true, fullName: true } }, _count: { select: { versions: true } } };
const kinds = new Set(["Agreement", "Letter"]);
const correspondenceStatuses = new Set(["Draft", "ReadyToIssue", "Issued", "Signed", "Finalized"]);
function clean(value, max, fallback = "") { return String(value ?? fallback).trim().slice(0, max); }
function tags(value) { return [...new Set((Array.isArray(value) ? value : []).map((item) => clean(item, 80).toLowerCase()).filter(Boolean))]; }

async function scopedCase(req, caseId) {
  const data = await prisma.case.findFirst({ where: { id: caseId, agencyId: req.user.agencyId }, include: { client: true, assignedUser: true } });
  if (!data) throw createHttpError(404, "Case not found");
  return data;
}

export async function listCorrespondenceTemplates(req, res) {
  const caseItem = req.query.caseId ? await scopedCase(req, String(req.query.caseId)) : null;
  await ensureDefaultCorrespondenceTemplates(req.user.agencyId);
  const data = await prisma.correspondenceTemplate.findMany({ where: { agencyId: req.user.agencyId, isActive: true, ...(req.query.kind && kinds.has(req.query.kind) ? { kind: req.query.kind } : {}) }, include: templateInclude, orderBy: [{ kind: "asc" }, { category: "asc" }, { title: "asc" }] });
  const context = caseItem ? await getCorrespondenceContext(req.user.agencyId, caseItem.id, req.user.id) : null;
  res.json({ data: data.map((item) => ({ ...item, suggested: caseItem ? templateMatchesCase(item, caseItem.caseType) : false, ...(context ? { preview: renderCorrespondenceHtml(item.contentHtml, context) } : {}) })), meta: { total: data.length, editableDefaults: true } });
}

export async function createCorrespondenceTemplate(req, res) {
  const kind = kinds.has(req.body.kind) ? req.body.kind : "Letter";
  const title = clean(req.body.title, 180);
  if (!title) throw createHttpError(400, "Template title is required");
  const contentHtml = String(req.body.contentHtml || "");
  if (!contentHtml.trim()) throw createHttpError(400, "Template content is required");
  if (contentHtml.length > 2_000_000) throw createHttpError(413, "Template content is too large");
  const slug = clean(req.body.slug || `${title}-${Date.now()}`, 220).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  try {
    const data = await prisma.correspondenceTemplate.create({ data: { agencyId: req.user.agencyId, slug, title, kind, category: clean(req.body.category, 100, "Custom") || "Custom", description: clean(req.body.description, 500) || null, contentHtml, caseTags: tags(req.body.caseTags), createdById: req.user.id, updatedById: req.user.id, versions: { create: { agencyId: req.user.agencyId, versionNumber: 1, title, kind, category: clean(req.body.category, 100, "Custom") || "Custom", description: clean(req.body.description, 500) || null, contentHtml, caseTags: tags(req.body.caseTags), createdById: req.user.id } } }, include: templateInclude });
    await recordActivity({ agencyId: req.user.agencyId, userId: req.user.id, action: "correspondence_template.created", details: `${data.title} template created` });
    res.status(201).json({ data });
  } catch (error) { if (error.code === "P2002") throw createHttpError(409, "A template with this name already exists"); throw error; }
}

export async function updateCorrespondenceTemplate(req, res) {
  const existing = await prisma.correspondenceTemplate.findFirst({ where: { id: req.params.id, agencyId: req.user.agencyId } });
  if (!existing) throw createHttpError(404, "Correspondence template not found");
  const title = req.body.title === undefined ? existing.title : clean(req.body.title, 180);
  if (!title) throw createHttpError(400, "Template title is required");
  const kind = req.body.kind === undefined ? existing.kind : kinds.has(req.body.kind) ? req.body.kind : null;
  if (!kind) throw createHttpError(400, "Invalid correspondence type");
  const contentHtml = req.body.contentHtml === undefined ? existing.contentHtml : String(req.body.contentHtml);
  if (!contentHtml.trim()) throw createHttpError(400, "Template content is required");
  if (contentHtml.length > 2_000_000) throw createHttpError(413, "Template content is too large");
  const next = { title, kind, category: req.body.category === undefined ? existing.category : clean(req.body.category, 100, "Custom") || "Custom", description: req.body.description === undefined ? existing.description : clean(req.body.description, 500) || null, contentHtml, caseTags: req.body.caseTags === undefined ? existing.caseTags : tags(req.body.caseTags) };
  const data = await prisma.$transaction(async (tx) => { const versionNumber = existing.versionNumber + 1; await tx.correspondenceTemplateVersion.create({ data: { agencyId: req.user.agencyId, correspondenceTemplateId: existing.id, versionNumber, ...next, createdById: req.user.id } }); return tx.correspondenceTemplate.update({ where: { id: existing.id }, data: { ...next, versionNumber, updatedById: req.user.id }, include: templateInclude }); });
  await recordActivity({ agencyId: req.user.agencyId, userId: req.user.id, action: "correspondence_template.updated", details: `${data.title} template updated to version ${data.versionNumber}` });
  res.json({ data });
}

export async function listCorrespondenceTemplateVersions(req, res) {
  const template = await prisma.correspondenceTemplate.findFirst({ where: { id: req.params.id, agencyId: req.user.agencyId }, select: { id: true } });
  if (!template) throw createHttpError(404, "Correspondence template not found");
  const data = await prisma.correspondenceTemplateVersion.findMany({ where: { correspondenceTemplateId: template.id }, include: { createdBy: { select: { id: true, fullName: true } } }, orderBy: { versionNumber: "desc" } });
  res.json({ data });
}

export async function restoreCorrespondenceTemplateVersion(req, res) {
  const [template, version] = await Promise.all([prisma.correspondenceTemplate.findFirst({ where: { id: req.params.id, agencyId: req.user.agencyId } }), prisma.correspondenceTemplateVersion.findFirst({ where: { id: req.params.versionId, correspondenceTemplateId: req.params.id, agencyId: req.user.agencyId } })]);
  if (!template || !version) throw createHttpError(404, "Template version not found");
  req.body = { title: version.title, kind: version.kind, category: version.category, description: version.description, contentHtml: version.contentHtml, caseTags: version.caseTags };
  return updateCorrespondenceTemplate(req, res);
}

export async function createCorrespondenceDraft(req, res) {
  const [template, caseItem] = await Promise.all([prisma.correspondenceTemplate.findFirst({ where: { id: req.params.id, agencyId: req.user.agencyId, isActive: true } }), scopedCase(req, String(req.body.caseId || ""))]);
  if (!template) throw createHttpError(404, "Correspondence template not found");
  const context = await getCorrespondenceContext(req.user.agencyId, caseItem.id, req.user.id);
  const rendered = renderCorrespondenceHtml(template.contentHtml, context);
  const title = clean(req.body.title, 200, `${template.title} — ${caseItem.client.fullName}`) || `${template.title} — ${caseItem.client.fullName}`;
  const agency = context.agency;
  const data = await prisma.writtenDocument.create({ data: { agencyId: req.user.agencyId, clientId: caseItem.clientId, caseId: caseItem.id, title, contentHtml: rendered.html, headerText: agency?.name || null, footerText: [agency?.email, agency?.phone].filter(Boolean).join(" · ") || null, status: "Draft", correspondenceStatus: "Draft", correspondenceKind: template.kind, correspondenceTemplateId: template.id, createdById: req.user.id, updatedById: req.user.id }, include: documentInclude });
  await recordActivity({ agencyId: req.user.agencyId, userId: req.user.id, clientId: caseItem.clientId, caseId: caseItem.id, action: "correspondence.draft_created", details: `${data.title} created from ${template.title} version ${template.versionNumber}` });
  res.status(201).json({ data: { ...data, missingFields: rendered.missing } });
}

export async function createCustomCorrespondenceDraft(req, res) {
  const caseItem = await scopedCase(req, String(req.body.caseId || ""));
  const kind = kinds.has(req.body.kind) ? req.body.kind : "Letter";
  const context = await getCorrespondenceContext(req.user.agencyId, caseItem.id, req.user.id);
  const title = clean(req.body.title, 200, `Custom ${kind}`) || `Custom ${kind}`;
  const base = kind === "Agreement" ? `<h1>${title}</h1><p><strong>Date:</strong> {{current.longDate}}</p><p>This agreement is between <strong>{{client.fullName}}</strong> and <strong>{{agency.name}}</strong>.</p><p>[Add agreement terms]</p><h2>Signatures</h2><p>Client: ____________________ Date: __________</p><p>Consultant: ________________ Date: __________</p>` : `<p>{{current.longDate}}</p><p><strong>{{agency.name}}</strong><br>{{agency.address}}<br>{{agency.phone}} · {{agency.email}}</p><p>{{client.fullName}}<br>{{client.address}}</p><p><strong>Re: ${title}</strong></p><p>Dear {{client.fullName}},</p><p>[Start writing your letter]</p><p>Sincerely,</p><p>{{consultant.fullName}}<br>{{agency.name}}</p>`;
  const rendered = renderCorrespondenceHtml(base, context);
  const data = await prisma.writtenDocument.create({ data: { agencyId: req.user.agencyId, clientId: caseItem.clientId, caseId: caseItem.id, title, contentHtml: rendered.html, headerText: context.agency?.name || null, footerText: [context.agency?.email, context.agency?.phone].filter(Boolean).join(" · ") || null, status: "Draft", correspondenceStatus: "Draft", correspondenceKind: kind, createdById: req.user.id, updatedById: req.user.id }, include: documentInclude });
  await recordActivity({ agencyId: req.user.agencyId, userId: req.user.id, clientId: caseItem.clientId, caseId: caseItem.id, action: "correspondence.custom_draft_created", details: `${title} custom ${kind.toLowerCase()} created` });
  res.status(201).json({ data });
}

export async function listCaseCorrespondence(req, res) {
  const caseItem = await scopedCase(req, req.params.caseId);
  const data = await prisma.writtenDocument.findMany({ where: { agencyId: req.user.agencyId, caseId: caseItem.id, correspondenceKind: { not: null } }, include: documentInclude, orderBy: { updatedAt: "desc" } });
  res.json({ data });
}

export async function updateCorrespondenceStatus(req, res) {
  const status = clean(req.body.status, 40);
  if (!correspondenceStatuses.has(status)) throw createHttpError(400, "Invalid correspondence status");
  const existing = await prisma.writtenDocument.findFirst({ where: { id: req.params.id, agencyId: req.user.agencyId, correspondenceKind: { not: null } }, include: { clientDocument: true } });
  if (!existing) throw createHttpError(404, "Agreement or letter not found");
  if (["Issued", "Signed", "Finalized"].includes(status) && !existing.clientDocumentId) throw createHttpError(409, "Save the document to CaseDesk before marking it issued or signed");
  const issued = ["Issued", "Signed", "Finalized"].includes(status);
  let publishedDocumentId = existing.issuedClientDocumentId;
  let copiedStorageKey = null;

  if (issued && !publishedDocumentId) {
    if (!existing.clientDocument?.storageKey) throw createHttpError(409, "The saved working file is unavailable");
    const extension = path.extname(existing.clientDocument.originalFilename || "").toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 12) || ".docx";
    copiedStorageKey = path.posix.join(req.user.agencyId, existing.caseId, `${randomUUID()}${extension}`);
    try {
      await copyStorageFile(DOCUMENT_BUCKET, existing.clientDocument.storageKey, copiedStorageKey);
      let normalizedName = normalizeDocumentName(existing.title);
      const duplicate = await prisma.clientDocument.findFirst({ where: { caseId: existing.caseId, normalizedName } });
      if (duplicate) normalizedName = normalizeDocumentName(`${existing.title} issued ${Date.now()}`);
      const published = await prisma.clientDocument.create({ data: { agencyId: req.user.agencyId, clientId: existing.clientId, caseId: existing.caseId, documentName: existing.title, normalizedName, visibility: "Client", status: "Uploaded", notes: `Issued ${existing.correspondenceKind.toLowerCase()} from CaseDesk Writer`, storageKey: copiedStorageKey, originalFilename: existing.clientDocument.originalFilename, mimeType: existing.clientDocument.mimeType, fileSize: existing.clientDocument.fileSize, receivedAt: new Date(), uploadedById: req.user.id } });
      publishedDocumentId = published.id;
    } catch (error) {
      if (copiedStorageKey) await removeStorageFile(DOCUMENT_BUCKET, copiedStorageKey).catch(() => {});
      throw error;
    }
  }

  const data = await prisma.writtenDocument.update({ where: { id: existing.id }, data: { correspondenceStatus: status, ...(publishedDocumentId ? { issuedClientDocumentId: publishedDocumentId } : {}), ...(issued ? { issuedAt: existing.issuedAt || new Date(), issuedById: req.user.id } : status === "Draft" ? { issuedAt: null, issuedById: null, issuedClientDocumentId: null } : {}) }, include: documentInclude });
  await recordActivity({ agencyId: req.user.agencyId, userId: req.user.id, clientId: existing.clientId, caseId: existing.caseId, action: "correspondence.status_updated", details: `${existing.title} marked ${status.toLowerCase()}` });
  res.json({ data });
}

export async function deleteCaseCorrespondence(req, res) {
  const existing = await prisma.writtenDocument.findFirst({
    where: {
      id: req.params.id,
      agencyId: req.user.agencyId,
      correspondenceKind: { not: null },
    },
    include: { clientDocument: true, issuedClientDocument: true },
  });
  if (!existing) throw createHttpError(404, "Agreement or letter not found");

  const linkedDocuments = [existing.clientDocument, existing.issuedClientDocument].filter(Boolean);
  await prisma.$transaction(async (tx) => {
    await tx.writtenDocument.delete({ where: { id: existing.id } });
    if (linkedDocuments.length) {
      await tx.clientDocument.deleteMany({
        where: {
          id: { in: linkedDocuments.map((item) => item.id) },
          agencyId: req.user.agencyId,
        },
      });
    }
  });
  await Promise.all(
    linkedDocuments
      .map((item) => item.storageKey)
      .filter(Boolean)
      .map((key) => removeStorageFile(DOCUMENT_BUCKET, key).catch(() => {})),
  );
  await recordActivity({
    agencyId: req.user.agencyId,
    userId: req.user.id,
    clientId: existing.clientId,
    caseId: existing.caseId,
    action: "correspondence.deleted",
    details: `${existing.title} deleted`,
  });
  res.status(204).send();
}

export async function deleteCorrespondenceTemplate(req, res) {
  const existing = await prisma.correspondenceTemplate.findFirst({
    where: { id: req.params.id, agencyId: req.user.agencyId, isActive: true },
  });
  if (!existing) throw createHttpError(404, "Correspondence template not found");
  await prisma.correspondenceTemplate.update({
    where: { id: existing.id },
    data: { isActive: false, updatedById: req.user.id },
  });
  await recordActivity({
    agencyId: req.user.agencyId,
    userId: req.user.id,
    action: "correspondence_template.deleted",
    details: `${existing.title} removed from the agency template catalog`,
  });
  res.status(204).send();
}
