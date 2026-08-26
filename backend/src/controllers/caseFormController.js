import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import prisma from "../services/prisma/client.js";
import { DOCUMENT_BUCKET, downloadStorageFile, removeStorageFile, uploadStorageFile } from "../services/supabaseStorage.js";
import { buildCaseFormCatalog, getOfficialForm } from "../services/formProgramCatalog.js";
import { createHttpError } from "../utils/http.js";
import { normalizeDocumentName } from "../utils/documentNames.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { assertFormUnlocked, formPermissionKeys, getFormPermissions, requireFormPermission } from "../services/formPermissions.js";
import { recordFormAudit } from "../utils/formAudit.js";
import { adminRecipientIds, caseNotificationActionUrl, internalCaseRecipientIds, notifyUsers } from "../services/notificationService.js";
import { caseAccessWhere } from "../middleware/authorization.js";
import { caseFormAccessWhere, caseFormChildAccessWhere } from "../services/caseFormAccessService.js";
import { imm5476RepresentativeSignatureName, rebuildImm5476FromOriginal, stampXfaPdfFormValues } from "../services/pdfFormRenderService.js";
import { MAX_SIGNATURE_FILL_FRACTION, MIN_SIGNATURE_FILL_FRACTION, REPRESENTATIVE_SIGNATURE, resolveSignatureFillFraction } from "../services/imm5476SignatureFields.js";
import { isTracedImageSignature, traceSignatureImageToStrokes } from "../services/signatureImageTrace.js";

const maxFileSize = 25 * 1024 * 1024;
const statuses = new Set(["Assigned", "InformationMissing", "ReadyToFill", "InProgress", "ReadyForReview", "ChangesRequested", "Approved", "SignatureRequired", "Signed", "Finalized", "NotRequired"]);
const requirements = new Set(["Required", "Conditional", "Optional"]);
const uploadCopyTypes = new Set(["Working", "Filled", "ClientSigned"]);
const browserCopyTypes = new Set(["Working", "Filled"]);
const allowedOfficialHosts = new Set(["canada.ca", "www.canada.ca", "ircc.canada.ca", "www.ircc.canada.ca"]);

const representativeUserSelect = { id: true, fullName: true, firstName: true, lastName: true, email: true, phone: true, licenseNumber: true, representativeType: true, membershipBody: true, membershipProvince: true, formOfficePhone: true, formOfficeEmail: true };
const include = {
  uploadedBy: { select: { id: true, fullName: true } },
  lockedBy: { select: { id: true, fullName: true } },
  // Whoever's explicitly picked as this form's representative (defaults to
  // the case's assigned consultant client-side when null) and, for cases
  // with more than one applicant, which ImmigrationProfile this copy is for.
  representativeUser: { select: representativeUserSelect },
  applicantProfile: { select: { id: true, givenNames: true, familyName: true } },
  _count: { select: { versions: true, reviewComments: true } },
};
const versionInclude = { createdBy: { select: { id: true, fullName: true } } };
const reviewCommentInclude = { createdBy: { select: { id: true, fullName: true } }, resolvedBy: { select: { id: true, fullName: true } } };

async function removeStoredFile(storageKey) {
  if (!storageKey) return;
  await removeStorageFile(DOCUMENT_BUCKET, storageKey);
}

function hashBuffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function revisionFromUrl(value, fallback = null) {
  const match = String(value || "").match(/\/(\d{2})-(\d{2})-(\d{4})\//);
  return match ? `${match[3]}-${match[2]}` : fallback;
}

function importedVersionStatus(entry, revision) {
  if (entry.mappingVersion && entry.revision && revision !== entry.revision) return "UnsupportedRevision";
  return "Current";
}

function assertOfficialUrl(value) {
  let parsed;
  try { parsed = new URL(value); } catch { throw createHttpError(400, "The official form URL is invalid"); }
  if (parsed.protocol !== "https:" || !allowedOfficialHosts.has(parsed.hostname.toLowerCase())) {
    throw createHttpError(400, "Official forms can only be imported from approved Government of Canada hosts");
  }
  return parsed;
}

async function fetchOfficial(url) {
  assertOfficialUrl(url);
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(30000), headers: { "user-agent": "CaseDesk/1.0 official-form-import" } });
  assertOfficialUrl(response.url);
  if (!response.ok) throw createHttpError(502, `IRCC returned ${response.status} while downloading this form`);
  return response;
}

function findPdfLink(html, baseUrl, formNumber) {
  const candidates = [...html.matchAll(/href=["']([^"']+)["']/gi)]
    .map((match) => match[1].replaceAll("&amp;", "&"))
    .filter((href) => /\.pdf(?:$|[?#])/i.test(href))
    .map((href) => new URL(href, baseUrl).toString())
    .filter((href) => { try { assertOfficialUrl(href); return true; } catch { return false; } });
  const token = String(formNumber || "").replace(/\s+/g, "").toLowerCase();
  return candidates.find((candidate) => candidate.toLowerCase().replace(/[^a-z0-9]/g, "").includes(token)) || candidates[0] || null;
}

function responseFilename(response, fallback) {
  const disposition = response.headers.get("content-disposition") || "";
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plain = disposition.match(/filename=["']?([^"';]+)/i)?.[1];
  const pathname = new URL(response.url).pathname;
  return decodeURIComponent(encoded || plain || path.basename(pathname) || fallback).replace(/[\\/]/g, "-");
}

async function downloadOfficialForm(entry) {
  let response = await fetchOfficial(entry.officialUrl);
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("text/html")) {
    const html = await response.text();
    const fileUrl = findPdfLink(html, response.url, entry.number);
    if (!fileUrl) throw createHttpError(409, "IRCC does not provide a downloadable file for this form. Use the official link instead.");
    response = await fetchOfficial(fileUrl);
  }
  const length = Number(response.headers.get("content-length") || 0);
  if (length > maxFileSize) throw createHttpError(413, "The official form is larger than 25 MB");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxFileSize) throw createHttpError(413, "The official form is larger than 25 MB");
  const mimeType = (response.headers.get("content-type") || "application/pdf").split(";")[0];
  if (mimeType.includes("text/html")) throw createHttpError(409, "IRCC did not return a downloadable form file");
  return { buffer, mimeType, filename: responseFilename(response, `${entry.number}.pdf`), resolvedUrl: response.url, revision: revisionFromUrl(response.url, entry.revision) };
}

async function existingSnapshot(existing) {
  if (!existing.storageKey) return null;
  const buffer = await downloadStorageFile(DOCUMENT_BUCKET, existing.storageKey, { allowMissing: true });
  if (!buffer) return null;
  return {
    source: existing.currentCopyType === "Original" && existing.sourceDownloadedAt ? "OfficialImport" : "CustomUpload",
    copyType: existing.currentCopyType || (existing.sourceDownloadedAt ? "Original" : "Working"),
    language: existing.language || "English",
    sourceRevision: existing.sourceRevision,
    fileHash: existing.fileHash || hashBuffer(buffer),
    officialUrl: existing.officialUrl,
    mappingVersion: existing.mappingVersion,
    storageKey: existing.storageKey,
    originalFilename: existing.originalFilename || "form",
    mimeType: existing.mimeType || "application/octet-stream",
    fileSize: existing.fileSize || buffer.length,
    sourceDownloadedAt: existing.sourceDownloadedAt,
    createdById: existing.uploadedById,
  };
}

async function ensureExistingVersion(tx, existing, createdById) {
  const latest = await tx.caseFormVersion.aggregate({ where: { caseFormId: existing.id }, _max: { versionNumber: true } });
  let latestNumber = latest._max.versionNumber || 0;
  if (latestNumber === 0) {
    const previous = await existingSnapshot(existing);
    if (previous) {
      await tx.caseFormVersion.create({ data: { agencyId: existing.agencyId, caseFormId: existing.id, versionNumber: 1, ...previous, createdById: previous.createdById || createdById } });
      latestNumber = 1;
    }
  }
  return latestNumber;
}

async function appendVersion(tx, { existing, snapshot, createdById }) {
  const latestNumber = await ensureExistingVersion(tx, existing, createdById);
  const versionNumber = latestNumber + 1;
  const version = await tx.caseFormVersion.create({ data: { agencyId: existing.agencyId, caseFormId: existing.id, versionNumber, ...snapshot, createdById }, include: versionInclude });
  return version;
}

async function latestOriginalSnapshot(existing) {
  if (existing.currentCopyType === "Original") return existingSnapshot(existing);
  return prisma.caseFormVersion.findFirst({ where: { caseFormId: existing.id, copyType: "Original" }, orderBy: { versionNumber: "desc" } });
}

async function getCase(req, caseId) {
  const caseItem = await prisma.case.findFirst({
    where: { id: caseId, agencyId: req.user.agencyId, ...caseAccessWhere(req) },
    include: { client: { select: { id: true, dateOfBirth: true } }, assessment: true },
  });
  if (!caseItem) throw createHttpError(404, "Case not found");
  return caseItem;
}

function normalizedFormName(number, title) {
  return normalizeDocumentName([number, title].filter(Boolean).join(" "));
}

export async function getCaseFormCatalog(req, res) {
  const caseItem = await getCase(req, String(req.query.caseId || ""));
  res.json({ data: buildCaseFormCatalog(caseItem, caseItem.assessment) });
}

export async function listCaseForms(req, res) {
  const caseId = String(req.query.caseId || "");
  await getCase(req, caseId);
  const data = await prisma.caseForm.findMany({ where: { agencyId: req.user.agencyId, caseId }, include, orderBy: [{ status: "asc" }, { createdAt: "desc" }] });
  res.json({ data: data.map((item) => ({ ...item, importable: item.catalogId ? getOfficialForm(item.catalogId)?.importable !== false : false })), meta: { permissions: await getFormPermissions(req) } });
}

export async function assignCatalogForms(req, res) {
  await requireFormPermission(req, "canAssign");
  const caseItem = await getCase(req, String(req.body.caseId || ""));
  const catalogIds = [...new Set(Array.isArray(req.body.catalogIds) ? req.body.catalogIds : [])];
  if (!catalogIds.length) throw createHttpError(400, "Select at least one form");
  const catalog = buildCaseFormCatalog(caseItem, caseItem.assessment);
  const entries = catalogIds.map((id) => getOfficialForm(id));
  if (entries.some((entry) => !entry)) throw createHttpError(400, "One or more selected forms are not in the official catalog");
  const data = [];
  for (const entry of entries) {
    const evaluated = catalog.forms.find((item) => item.id === entry.id);
    const record = await prisma.caseForm.upsert({
      where: { caseId_normalizedName: { caseId: caseItem.id, normalizedName: normalizedFormName(entry.number, entry.title) } },
      update: { status: "Assigned", requirement: evaluated.requirement, selectionReason: evaluated.reason, officialUrl: entry.officialUrl, language: entry.language, mappingVersion: entry.mappingVersion },
      create: { agencyId: req.user.agencyId, clientId: caseItem.clientId, caseId: caseItem.id, catalogId: entry.id, formNumber: entry.number, title: entry.title, normalizedName: normalizedFormName(entry.number, entry.title), source: "Catalog", requirement: evaluated.requirement, selectionReason: evaluated.reason, officialUrl: entry.officialUrl, language: entry.language, mappingVersion: entry.mappingVersion, availableRevision: entry.revision, versionStatus: entry.importable === false ? "PortalOnly" : "Unverified" },
      include,
    });
    data.push({ ...record, importable: entry.importable !== false });
  }
  await recordActivity({ agencyId: req.user.agencyId, userId: req.user.id, clientId: caseItem.clientId, caseId: caseItem.id, action: "case_forms.assigned", details: `${data.length} official form${data.length === 1 ? "" : "s"} assigned` });
  await Promise.all(data.map((form) => recordFormAudit({ form, event: "Assigned", details: "Official form assigned to the case", userId: req.user.id })));
  res.status(201).json({ data });
}

export async function createCustomCaseForm(req, res) {
  await requireFormPermission(req, "canAssign");
  const caseItem = await getCase(req, String(req.body.caseId || ""));
  const title = String(req.body.title || req.file?.originalname || "").trim();
  if (!title) throw createHttpError(400, "Form title is required");
  const requirement = requirements.has(req.body.requirement) ? req.body.requirement : "Required";
  const language = String(req.body.language || "English").trim().slice(0, 40) || "English";
  const sourceRevision = String(req.body.sourceRevision || "").trim().slice(0, 40) || null;
  const fileHash = req.file ? hashBuffer(req.file.buffer) : null;
  let storageKey = null;
  if (req.file) {
    const extension = path.extname(req.file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 12);
    storageKey = path.posix.join(req.user.agencyId, caseItem.id, "forms", `${randomUUID()}${extension}`);
    await uploadStorageFile(DOCUMENT_BUCKET, storageKey, req.file.buffer, req.file.mimetype);
  }
  try {
    const data = await prisma.caseForm.create({ data: { agencyId: req.user.agencyId, clientId: caseItem.clientId, caseId: caseItem.id, title, formNumber: String(req.body.formNumber || "").trim() || null, normalizedName: normalizedFormName(req.body.formNumber, title), source: "Custom", requirement, selectionReason: String(req.body.selectionReason || "Added by consultant").trim(), status: req.file ? "InProgress" : "Assigned", language, sourceRevision, versionStatus: req.file ? "Current" : "Unverified", currentCopyType: "Original", ...(req.file ? { storageKey, originalFilename: req.file.originalname, mimeType: req.file.mimetype, fileSize: req.file.size, fileHash, uploadedById: req.user.id, versions: { create: { agencyId: req.user.agencyId, versionNumber: 1, source: "CustomUpload", copyType: "Original", language, sourceRevision, fileHash, storageKey, originalFilename: req.file.originalname, mimeType: req.file.mimetype, fileSize: req.file.size, createdById: req.user.id } } } : {}) }, include });
    await recordActivity({ agencyId: req.user.agencyId, userId: req.user.id, clientId: caseItem.clientId, caseId: caseItem.id, action: "case_form.custom_created", details: `${title} added to the case` });
    await recordFormAudit({ form: data, event: "Assigned", details: "Custom form added to the case", userId: req.user.id });
    res.status(201).json({ data });
  } catch (error) {
    await removeStoredFile(storageKey);
    if (error.code === "P2002") throw createHttpError(409, "This form is already assigned to the case");
    throw error;
  }
}

async function storeUploadedCaseFormCopy(req, res, { versionSource, allowedCopyTypes, defaultCopyType, activityAction }) {
  await requireFormPermission(req, "canEdit");
  if (!req.file) throw createHttpError(400, "A form file is required");
  const existing = await prisma.caseForm.findFirst({ where: caseFormAccessWhere(req, { id: req.params.id }) });
  if (!existing) throw createHttpError(404, "Case form not found");
  assertFormUnlocked(existing);
  const copyType = allowedCopyTypes.has(req.body.copyType) ? req.body.copyType : defaultCopyType;
  const extension = path.extname(req.file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 12);
  const storageKey = path.posix.join(req.user.agencyId, existing.caseId, "forms", `${randomUUID()}${extension}`);
  await uploadStorageFile(DOCUMENT_BUCKET, storageKey, req.file.buffer, req.file.mimetype);
  const fileHash = hashBuffer(req.file.buffer);
  try {
    const data = await prisma.$transaction(async (tx) => {
      await appendVersion(tx, { existing, createdById: req.user.id, snapshot: { source: versionSource, copyType, language: existing.language || "English", sourceRevision: existing.sourceRevision, fileHash, officialUrl: existing.officialUrl, mappingVersion: existing.mappingVersion, storageKey, originalFilename: req.file.originalname, mimeType: req.file.mimetype, fileSize: req.file.size, sourceDownloadedAt: existing.sourceDownloadedAt } });
      return tx.caseForm.update({ where: { id: existing.id }, data: { storageKey, originalFilename: req.file.originalname, mimeType: req.file.mimetype, fileSize: req.file.size, fileHash, uploadedById: req.user.id, currentCopyType: copyType, versionStatus: existing.source === "Custom" ? "Current" : existing.versionStatus, status: copyType === "ClientSigned" ? "Signed" : "InProgress" }, include });
    });
    await recordActivity({ agencyId: req.user.agencyId, userId: req.user.id, clientId: existing.clientId, caseId: existing.caseId, action: activityAction, details: `${copyType} copy of ${existing.title} saved as version ${data._count.versions}` });
    await recordFormAudit({ form: data, event: copyType === "ClientSigned" ? "ClientSignedCopyUploaded" : copyType === "Working" ? "WorkingCopySaved" : "FilledCopySaved", details: `${copyType} copy saved as version ${data._count.versions}`, metadata: { copyType, versionCount: data._count.versions }, userId: req.user.id });
    res.json({ data });
  } catch (error) { await removeStoredFile(storageKey); throw error; }
}

export async function uploadCaseForm(req, res) {
  return storeUploadedCaseFormCopy(req, res, { versionSource: "CustomUpload", allowedCopyTypes: uploadCopyTypes, defaultCopyType: "Working", activityAction: "case_form.copy_uploaded" });
}

export async function saveBrowserCaseFormCopy(req, res) {
  return storeUploadedCaseFormCopy(req, res, { versionSource: "BrowserSave", allowedCopyTypes: browserCopyTypes, defaultCopyType: "Filled", activityAction: "case_form.browser_copy_saved" });
}

export async function importOfficialCaseForm(req, res) {
  await requireFormPermission(req, "canEdit");
  const existing = await prisma.caseForm.findFirst({ where: caseFormAccessWhere(req, { id: req.params.id }) });
  if (!existing) throw createHttpError(404, "Case form not found");
  assertFormUnlocked(existing);
  if (existing.source !== "Catalog" || !existing.catalogId) throw createHttpError(409, "Only official catalog forms can be imported");
  const entry = getOfficialForm(existing.catalogId);
  if (!entry) throw createHttpError(409, "This form is no longer present in the official catalog");
  if (entry.importable === false) throw createHttpError(409, "This form is completed through an external official process. Use the official link instead.");
  if (existing.storageKey && req.body.confirmReplace !== true) throw createHttpError(409, "This form already has a stored version. Check for updates and confirm replacement before importing a newer copy.");
  const file = await downloadOfficialForm(entry);
  const fileHash = hashBuffer(file.buffer);
  const downloadedAt = new Date();
  const versionStatus = importedVersionStatus(entry, file.revision);
  const mappingVersion = versionStatus === "UnsupportedRevision" ? null : entry.mappingVersion;
  const priorOriginal = await latestOriginalSnapshot(existing);
  if (priorOriginal?.fileHash === fileHash) {
    const data = await prisma.$transaction(async (tx) => {
      await ensureExistingVersion(tx, existing, req.user.id);
      return tx.caseForm.update({ where: { id: existing.id }, data: { ...(existing.currentCopyType === "Original" ? { fileHash } : {}), sourceRevision: file.revision, language: entry.language, mappingVersion, sourceDownloadedAt: existing.sourceDownloadedAt || downloadedAt, versionStatus, availableRevision: null, lastVersionCheckedAt: downloadedAt }, include });
    });
    res.json({ data, meta: { unchanged: true } });
    return;
  }
  const extension = path.extname(file.filename).toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 12) || ".pdf";
  const storageKey = path.posix.join(req.user.agencyId, existing.caseId, "forms", `${randomUUID()}${extension}`);
  await uploadStorageFile(DOCUMENT_BUCKET, storageKey, file.buffer, file.mimeType);
  try {
    const data = await prisma.$transaction(async (tx) => {
      await appendVersion(tx, { existing, createdById: req.user.id, snapshot: { source: "OfficialImport", copyType: "Original", language: entry.language, sourceRevision: file.revision, fileHash, officialUrl: file.resolvedUrl, mappingVersion, storageKey, originalFilename: file.filename, mimeType: file.mimeType, fileSize: file.buffer.length, sourceDownloadedAt: downloadedAt } });
      return tx.caseForm.update({ where: { id: existing.id }, data: { storageKey, originalFilename: file.filename, mimeType: file.mimeType, fileSize: file.buffer.length, fileHash, uploadedById: req.user.id, currentCopyType: "Original", sourceRevision: file.revision, language: entry.language, mappingVersion, sourceDownloadedAt: downloadedAt, versionStatus, availableRevision: null, lastVersionCheckedAt: downloadedAt, status: "InProgress" }, include });
    });
    await recordActivity({ agencyId: req.user.agencyId, userId: req.user.id, clientId: existing.clientId, caseId: existing.caseId, action: "case_form.official_imported", details: `${existing.formNumber || existing.title} imported from IRCC` });
    await recordFormAudit({ form: data, event: "OfficialRevisionImported", details: `Official revision ${file.revision || "unknown"} imported`, metadata: { revision: file.revision, fileHash }, userId: req.user.id });
    res.json({ data });
  } catch (error) { await removeStoredFile(storageKey); throw error; }
}

export async function checkCaseFormVersion(req, res) {
  const existing = await prisma.caseForm.findFirst({ where: caseFormAccessWhere(req, { id: req.params.id }) });
  if (!existing) throw createHttpError(404, "Case form not found");
  if (existing.source !== "Catalog" || !existing.catalogId) throw createHttpError(409, "Only official catalog forms can be checked for updates");
  const entry = getOfficialForm(existing.catalogId);
  if (!entry) {
    const data = await prisma.caseForm.update({ where: { id: existing.id }, data: { versionStatus: "UnsupportedRevision", lastVersionCheckedAt: new Date() }, include });
    res.json({ data, meta: { message: "This form is no longer present in the CaseDesk official catalog." } });
    return;
  }
  if (entry.importable === false) {
    const data = await prisma.caseForm.update({ where: { id: existing.id }, data: { versionStatus: "PortalOnly", lastVersionCheckedAt: new Date() }, include });
    res.json({ data, meta: { message: "This form is maintained through an external official process." } });
    return;
  }
  const checkedAt = new Date();
  try {
    const latest = await downloadOfficialForm(entry);
    const latestHash = hashBuffer(latest.buffer);
    const current = await latestOriginalSnapshot(existing);
    const incompatible = Boolean(entry.mappingVersion && entry.revision && latest.revision !== entry.revision);
    const versionStatus = !current ? "Unverified" : incompatible ? "UnsupportedRevision" : current.fileHash === latestHash ? "Current" : "UpdateAvailable";
    const data = await prisma.caseForm.update({ where: { id: existing.id }, data: { ...(current && !existing.fileHash && existing.currentCopyType === "Original" ? { fileHash: current.fileHash } : {}), versionStatus, availableRevision: current?.fileHash === latestHash ? null : latest.revision, lastVersionCheckedAt: checkedAt }, include });
    res.json({ data, meta: { latestRevision: latest.revision, latestHash, message: versionStatus === "Current" ? "The stored form matches the latest official file." : versionStatus === "UnsupportedRevision" ? "IRCC published a revision that does not yet have a verified CaseDesk mapping." : versionStatus === "UpdateAvailable" ? "A newer official file is available." : "Import the official form to establish the first version." } });
  } catch (error) {
    const data = await prisma.caseForm.update({ where: { id: existing.id }, data: { versionStatus: "SourceUnavailable", lastVersionCheckedAt: checkedAt }, include });
    res.json({ data, meta: { message: error.message || "The official source could not be checked." } });
  }
}

export async function monitorAssignedCaseFormRevisions({ agencyId = null, formIds = null, limit = 250 } = {}) {
  const forms = await prisma.caseForm.findMany({ where: { ...(agencyId ? { agencyId } : {}), ...(formIds?.length ? { id: { in: formIds } } : {}), source: "Catalog", catalogId: { not: null } }, orderBy: { lastVersionCheckedAt: { sort: "asc", nulls: "first" } }, take: limit });
  const summary = { checked: 0, current: 0, updates: 0, unsupported: 0, unavailable: 0, portalOnly: 0 };
  for (const form of forms) {
    const entry = getOfficialForm(form.catalogId);
    const checkedAt = new Date();
    let versionStatus = "UnsupportedRevision";
    let availableRevision = null;
    try {
      if (!entry) versionStatus = "UnsupportedRevision";
      else if (entry.importable === false) versionStatus = "PortalOnly";
      else {
        const latest = await downloadOfficialForm(entry);
        const latestHash = hashBuffer(latest.buffer);
        const current = await latestOriginalSnapshot(form);
        const incompatible = Boolean(entry.mappingVersion && entry.revision && latest.revision !== entry.revision);
        versionStatus = !current ? "Unverified" : incompatible ? "UnsupportedRevision" : current.fileHash === latestHash ? "Current" : "UpdateAvailable";
        availableRevision = current?.fileHash === latestHash ? null : latest.revision;
      }
    } catch {
      versionStatus = "SourceUnavailable";
    }
    const updated = await prisma.caseForm.update({ where: { id: form.id }, data: { versionStatus, availableRevision, lastVersionCheckedAt: checkedAt } });
    summary.checked += 1;
    if (versionStatus === "Current") summary.current += 1;
    else if (versionStatus === "UpdateAvailable") summary.updates += 1;
    else if (versionStatus === "UnsupportedRevision") summary.unsupported += 1;
    else if (versionStatus === "SourceUnavailable") summary.unavailable += 1;
    else if (versionStatus === "PortalOnly") summary.portalOnly += 1;
    if (versionStatus !== form.versionStatus) {
      await recordFormAudit({ form: updated, event: "RevisionStatusChanged", details: `Revision status changed from ${form.versionStatus} to ${versionStatus}`, metadata: { from: form.versionStatus, to: versionStatus, availableRevision } });
      if (["UpdateAvailable", "UnsupportedRevision", "SourceUnavailable"].includes(versionStatus)) {
        const caseRecipients = await internalCaseRecipientIds(form.agencyId, form.caseId);
        await notifyUsers({ agencyId: form.agencyId, recipientIds: caseRecipients.length ? caseRecipients : await adminRecipientIds(form.agencyId), type: `case_form.revision_${versionStatus.toLowerCase()}`, category: "documents", title: versionStatus === "UpdateAvailable" ? `New official form revision: ${form.title}` : `Official form needs attention: ${form.title}`, body: availableRevision ? `Revision ${availableRevision} is available.` : `Revision status: ${versionStatus}.`, severity: versionStatus === "UpdateAvailable" ? "warning" : "critical", entityType: "case_form", entityId: form.id, actionUrl: caseNotificationActionUrl(form.caseId, { type: `case_form.revision_${versionStatus.toLowerCase()}`, category: "documents" }), dedupeKey: `case-form:${form.id}:revision:${versionStatus}:${availableRevision || "none"}` });
      }
    }
  }
  return summary;
}

export async function listCaseFormVersions(req, res) {
  const existing = await prisma.caseForm.findFirst({ where: caseFormAccessWhere(req, { id: req.params.id }) });
  if (!existing) throw createHttpError(404, "Case form not found");
  await prisma.$transaction((tx) => ensureExistingVersion(tx, existing, req.user.id));
  const data = await prisma.caseFormVersion.findMany({ where: { caseFormId: existing.id, agencyId: req.user.agencyId }, include: versionInclude, orderBy: { versionNumber: "desc" } });
  res.json({ data });
}

export async function serveCaseFormVersionFile(req, res) {
  const version = await prisma.caseFormVersion.findFirst({ where: caseFormChildAccessWhere(req, { id: req.params.versionId, caseFormId: req.params.id }) });
  if (!version) throw createHttpError(404, "Form version not found");
  const buffer = await downloadStorageFile(DOCUMENT_BUCKET, version.storageKey, { allowMissing: true });
  if (!buffer) throw createHttpError(404, "The stored version file was not found");
  res.setHeader("Content-Disposition", `${req.query.download === "1" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(version.originalFilename)}`);
  res.type(version.mimeType);
  res.send(buffer);
}

export async function restoreCaseFormVersion(req, res) {
  await requireFormPermission(req, "canEdit");
  const [existing, version] = await Promise.all([
    prisma.caseForm.findFirst({ where: caseFormAccessWhere(req, { id: req.params.id }) }),
    prisma.caseFormVersion.findFirst({ where: caseFormChildAccessWhere(req, { id: req.params.versionId, caseFormId: req.params.id }) }),
  ]);
  if (!existing) throw createHttpError(404, "Case form not found");
  assertFormUnlocked(existing);
  if (!version) throw createHttpError(404, "Form version not found");
  if (!(await downloadStorageFile(DOCUMENT_BUCKET, version.storageKey, { allowMissing: true }))) throw createHttpError(409, "The selected version file is unavailable");
  const restoredAt = new Date();
  const data = await prisma.$transaction(async (tx) => {
    await appendVersion(tx, { existing, createdById: req.user.id, snapshot: { source: "Restored", copyType: version.copyType, language: version.language, sourceRevision: version.sourceRevision, fileHash: version.fileHash, officialUrl: version.officialUrl, mappingVersion: version.mappingVersion, storageKey: version.storageKey, originalFilename: version.originalFilename, mimeType: version.mimeType, fileSize: version.fileSize, sourceDownloadedAt: version.sourceDownloadedAt } });
    return tx.caseForm.update({ where: { id: existing.id }, data: { language: version.language, sourceRevision: version.sourceRevision, fileHash: version.fileHash, mappingVersion: version.mappingVersion, storageKey: version.storageKey, originalFilename: version.originalFilename, mimeType: version.mimeType, fileSize: version.fileSize, sourceDownloadedAt: version.sourceDownloadedAt, uploadedById: req.user.id, currentCopyType: version.copyType, versionStatus: existing.source === "Catalog" ? "Unverified" : "Current", availableRevision: null, lastVersionCheckedAt: null, status: "InProgress", updatedAt: restoredAt }, include });
  });
  await recordActivity({ agencyId: req.user.agencyId, userId: req.user.id, clientId: existing.clientId, caseId: existing.caseId, action: "case_form.version_restored", details: `${existing.title} restored from version ${version.versionNumber}` });
  await recordFormAudit({ form: data, event: "VersionRestored", details: `Restored from version ${version.versionNumber}`, metadata: { restoredVersion: version.versionNumber }, userId: req.user.id });
  res.json({ data });
}

export async function serveCaseFormFile(req, res) {
  const data = await prisma.caseForm.findFirst({
    where: caseFormAccessWhere(req, { id: req.params.id }),
    select: {
      storageKey: true,
      originalFilename: true,
      mimeType: true,
      formNumber: true,
      id: true,
      currentCopyType: true,
      lockedAt: true,
      signatureScale: true,
      signatureScaleX: true,
      signatureScaleY: true,
      representativeUser: { select: { fullName: true, firstName: true, lastName: true, licenseNumber: true, formSignatureImage: true, formSignatureStrokes: true } },
    },
  });
  if (!data?.storageKey) throw createHttpError(404, "No stored file is available for this form");
  const storedBuffer = await downloadStorageFile(DOCUMENT_BUCKET, data.storageKey, { allowMissing: true });
  if (!storedBuffer) throw createHttpError(404, "The stored form file was not found");
  // Once the client has signed, the stored bytes are the actual legal record —
  // an applicant's ink signature is baked in as a PDF annotation, not a field
  // value, so re-stamping the (possibly since-changed) representative here
  // would either wipe it outright (rebuilding from the blank original carries
  // over field values only) or leave stale representative ink under a
  // freshly-overwritten representative name. Neither is acceptable once a
  // client has actually signed, so a signed/finalized copy is served exactly
  // as stored — a representative change after signing never touches it.
  const isImm5476 = String(data.formNumber || "").toUpperCase().replace(/[^A-Z0-9]/g, "") === "IMM5476";
  const isSignedCopy = data.currentCopyType === "ClientSigned" || data.currentCopyType === "Finalized";
  const signatureEditor = req.query.signatureEditor === "1";
  if (signatureEditor) {
    await requireFormPermission(req, "canEdit");
    assertFormUnlocked(data);
    if (!isImm5476) throw createHttpError(409, "Signature resizing is currently available for IMM 5476 forms");
    if (isSignedCopy) throw createHttpError(423, "A signed or finalized form cannot be changed");
  }
  const representative = data.representativeUser;
  const hasSavedSignature = representative?.formSignatureImage && Array.isArray(representative.formSignatureStrokes) && representative.formSignatureStrokes.length;
  const signatureStrokes = hasSavedSignature && isTracedImageSignature(representative.formSignatureStrokes)
    ? await traceSignatureImageToStrokes(Buffer.from(representative.formSignatureImage.split(",")[1], "base64"))
    : representative?.formSignatureStrokes;
  const agencySignatureScale = hasSavedSignature
    ? (await prisma.agency.findUnique({ where: { id: req.user.agencyId }, select: { governmentFormSignatureScale: true } }))?.governmentFormSignatureScale
    : undefined;
  const fallbackSignatureScale = data.signatureScale ?? agencySignatureScale;
  const signatureFillFraction = hasSavedSignature ? {
    x: resolveSignatureFillFraction(data.signatureScaleX ?? fallbackSignatureScale),
    y: resolveSignatureFillFraction(data.signatureScaleY ?? fallbackSignatureScale),
  } : undefined;
  let preparedBuffer = storedBuffer;
  if (isImm5476 && !isSignedCopy) {
    const embeddedSigner = await imm5476RepresentativeSignatureName(storedBuffer);
    const selectedSigner = hasSavedSignature ? representative.fullName.trim() : null;
    if (signatureEditor || (embeddedSigner && embeddedSigner.localeCompare(selectedSigner || "", undefined, { sensitivity: "base" }) !== 0)) {
      const originalVersion = await prisma.caseFormVersion.findFirst({
        where: { caseFormId: data.id, agencyId: req.user.agencyId, copyType: "Original" },
        select: { storageKey: true },
        orderBy: { versionNumber: "asc" },
      });
      const originalBuffer = originalVersion?.storageKey
        ? await downloadStorageFile(DOCUMENT_BUCKET, originalVersion.storageKey, { allowMissing: true })
        : data.currentCopyType === "Original" ? storedBuffer : null;
      if (!originalBuffer) throw createHttpError(409, "The original IMM 5476 is unavailable, so the previous representative signature could not be cleared. Import the official form again.");
      preparedBuffer = await rebuildImm5476FromOriginal(storedBuffer, originalBuffer);
    }
  }
  // Prefer the representative's explicit first/last name when set — same
  // "explicit beats guessed" rule imm5476.js's normalizeIrccName() uses for
  // the applicant side. Only guess from fullName (last word as family name)
  // when neither is on file.
  const representativeLastName = String(representative?.lastName || "").trim();
  const representativeNameParts = String(representative?.fullName || "").trim().split(/\s+/).filter(Boolean);
  const representativeFamilyName = representativeLastName || (representativeNameParts.length > 1 ? representativeNameParts.at(-1) : representativeNameParts[0] || "");
  const representativeGivenNames = representativeLastName
    ? String(representative?.firstName || "").trim()
    : (representativeNameParts.length > 1 ? representativeNameParts.slice(0, -1).join(" ") : "");
  const buffer = isImm5476 && !isSignedCopy
    ? await stampXfaPdfFormValues(
        preparedBuffer,
        [],
        {
          "547R": true,
          "561R": representativeFamilyName,
          "562R": representativeGivenNames,
          "102R": false,
          "101R": false,
          "100R": false,
          "97R": true,
          "96R": false,
          "95R": false,
          "94R": representative?.licenseNumber?.trim() || "",
        },
        hasSavedSignature && !signatureEditor ? { strokes: signatureStrokes, name: representative.fullName, fillFractionX: signatureFillFraction.x, fillFractionY: signatureFillFraction.y } : null,
      )
    : preparedBuffer;
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Disposition", `${req.query.download === "1" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(data.originalFilename || "form")}`);
  res.type(data.mimeType || "application/octet-stream");
  res.send(buffer);
}

export async function getCaseFormSignatureEditor(req, res) {
  await requireFormPermission(req, "canEdit");
  const form = await prisma.caseForm.findFirst({
    where: caseFormAccessWhere(req, { id: req.params.id }),
    select: {
      id: true,
      formNumber: true,
      currentCopyType: true,
      lockedAt: true,
      signatureScale: true,
      signatureScaleX: true,
      signatureScaleY: true,
      representativeUser: { select: { fullName: true, formSignatureImage: true, formSignatureStrokes: true } },
    },
  });
  if (!form) throw createHttpError(404, "Case form not found");
  assertFormUnlocked(form);
  if (String(form.formNumber || "").toUpperCase().replace(/[^A-Z0-9]/g, "") !== "IMM5476") throw createHttpError(409, "Signature resizing is currently available for IMM 5476 forms");
  if (["ClientSigned", "Finalized"].includes(form.currentCopyType)) throw createHttpError(423, "A signed or finalized form cannot be changed");
  const representative = form.representativeUser;
  if (!representative || !Array.isArray(representative.formSignatureStrokes) || !representative.formSignatureStrokes.length) {
    throw createHttpError(409, "The selected representative must save a signature before it can be resized on the form");
  }
  const strokes = representative.formSignatureImage && isTracedImageSignature(representative.formSignatureStrokes)
    ? await traceSignatureImageToStrokes(Buffer.from(representative.formSignatureImage.split(",")[1], "base64"))
    : representative.formSignatureStrokes;
  const agency = await prisma.agency.findUnique({ where: { id: req.user.agencyId }, select: { governmentFormSignatureScale: true } });
  const fallbackScale = form.signatureScale ?? agency?.governmentFormSignatureScale;
  res.json({ data: {
    strokes,
    signerName: representative.fullName,
    pageIndex: REPRESENTATIVE_SIGNATURE.pageIndex,
    rect: REPRESENTATIVE_SIGNATURE.rect,
    scaleX: resolveSignatureFillFraction(form.signatureScaleX ?? fallbackScale),
    scaleY: resolveSignatureFillFraction(form.signatureScaleY ?? fallbackScale),
    minScale: MIN_SIGNATURE_FILL_FRACTION,
    maxScale: MAX_SIGNATURE_FILL_FRACTION,
  } });
}

export async function updateCaseForm(req, res) {
  const existing = await prisma.caseForm.findFirst({ where: caseFormAccessWhere(req, { id: req.params.id }) });
  if (!existing) throw createHttpError(404, "Case form not found");
  assertFormUnlocked(existing);
  const status = req.body.status;
  if (status !== undefined && !statuses.has(status)) throw createHttpError(400, "Invalid form status");
  if (status === "Finalized") throw createHttpError(409, "Use the dedicated finalize operation so the finalized copy is locked and audited");
  const permission = ["Approved", "SignatureRequired", "Signed"].includes(status) ? "canApprove" : ["ReadyForReview", "ChangesRequested"].includes(status) ? "canReview" : "canEdit";
  await requireFormPermission(req, permission);
  if (["ReadyForReview", "Approved", "SignatureRequired", "Signed", "Finalized"].includes(status) && !existing.storageKey) throw createHttpError(409, "Upload or import the form before selecting this status");
  if (status === "Signed" && !["ClientSigned", "Finalized"].includes(existing.currentCopyType)) throw createHttpError(409, "Upload a client-signed copy before marking this form signed");
  if (status === "Finalized" && !["Approved", "Signed", "Finalized"].includes(existing.status)) throw createHttpError(409, "Approve the form or record a signed copy before finalizing it");
  const requirement = req.body.requirement;
  if (requirement !== undefined && !requirements.has(requirement)) throw createHttpError(400, "Invalid form requirement");
  const title = req.body.title !== undefined ? String(req.body.title).trim() : existing.title;
  if (!title) throw createHttpError(400, "Form title is required");
  const formNumber = req.body.formNumber !== undefined ? String(req.body.formNumber).trim() || null : existing.formNumber;
  let signatureScale;
  if (req.body.signatureScale !== undefined) {
    signatureScale = Number(req.body.signatureScale);
    if (!Number.isFinite(signatureScale) || signatureScale < MIN_SIGNATURE_FILL_FRACTION || signatureScale > MAX_SIGNATURE_FILL_FRACTION) {
      throw createHttpError(400, `Signature size must be between ${Math.round(MIN_SIGNATURE_FILL_FRACTION * 100)}% and ${Math.round(MAX_SIGNATURE_FILL_FRACTION * 100)}%`);
    }
  }
  const signatureDimensions = {};
  for (const key of ["signatureScaleX", "signatureScaleY"]) {
    if (req.body[key] === undefined) continue;
    const value = Number(req.body[key]);
    if (!Number.isFinite(value) || value < MIN_SIGNATURE_FILL_FRACTION || value > MAX_SIGNATURE_FILL_FRACTION) {
      throw createHttpError(400, `Signature dimensions must be between ${Math.round(MIN_SIGNATURE_FILL_FRACTION * 100)}% and ${Math.round(MAX_SIGNATURE_FILL_FRACTION * 100)}%`);
    }
    signatureDimensions[key] = value;
  }
  try {
    const data = await prisma.caseForm.update({ where: { id: existing.id }, data: { ...(status !== undefined ? { status } : {}), ...(requirement !== undefined ? { requirement } : {}), ...(signatureScale !== undefined ? { signatureScale } : {}), ...signatureDimensions, ...(req.body.title !== undefined ? { title } : {}), ...(req.body.formNumber !== undefined ? { formNumber } : {}), ...(req.body.selectionReason !== undefined ? { selectionReason: String(req.body.selectionReason).trim() || null } : {}), normalizedName: normalizedFormName(formNumber, title) }, include });
    if (signatureScale !== undefined || Object.keys(signatureDimensions).length) await recordFormAudit({ form: data, event: "SignatureResized", details: `Representative signature resized to ${Math.round((data.signatureScaleX ?? data.signatureScale ?? 0.8) * 100)}% wide × ${Math.round((data.signatureScaleY ?? data.signatureScale ?? 0.8) * 100)}% high`, metadata: { signatureScale, ...signatureDimensions }, userId: req.user.id });
    if (status !== undefined && status !== existing.status) { await recordActivity({ agencyId: req.user.agencyId, userId: req.user.id, clientId: existing.clientId, caseId: existing.caseId, action: "case_form.status_changed", details: `${existing.title} moved from ${existing.status} to ${status}` }); await recordFormAudit({ form: data, event: status, details: `Status changed from ${existing.status} to ${status}`, metadata: { from: existing.status, to: status }, userId: req.user.id }); }
    res.json({ data });
  } catch (error) { if (error.code === "P2002") throw createHttpError(409, "This form is already assigned to the case"); throw error; }
}

export async function listCaseFormReviewComments(req, res) {
  const form = await prisma.caseForm.findFirst({ where: caseFormAccessWhere(req, { id: req.params.id }), select: { id: true } });
  if (!form) throw createHttpError(404, "Case form not found");
  const data = await prisma.caseFormReviewComment.findMany({ where: { agencyId: req.user.agencyId, caseFormId: form.id }, include: reviewCommentInclude, orderBy: [{ resolvedAt: "asc" }, { createdAt: "desc" }] });
  res.json({ data });
}

export async function createCaseFormReviewComment(req, res) {
  await requireFormPermission(req, "canReview");
  const form = await prisma.caseForm.findFirst({ where: caseFormAccessWhere(req, { id: req.params.id }) });
  if (!form) throw createHttpError(404, "Case form not found");
  const comment = String(req.body.comment || "").trim();
  if (!comment) throw createHttpError(400, "Review comment is required");
  if (comment.length > 4000) throw createHttpError(400, "Review comment must be 4,000 characters or fewer");
  const pageNumber = req.body.pageNumber === null || req.body.pageNumber === undefined || req.body.pageNumber === "" ? null : Number(req.body.pageNumber);
  if (pageNumber !== null && (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 999)) throw createHttpError(400, "Page number must be between 1 and 999");
  const fieldName = String(req.body.fieldName || "").trim().slice(0, 160) || null;
  const data = await prisma.caseFormReviewComment.create({ data: { agencyId: req.user.agencyId, caseFormId: form.id, pageNumber, fieldName, comment, createdById: req.user.id }, include: reviewCommentInclude });
  await recordActivity({ agencyId: req.user.agencyId, userId: req.user.id, clientId: form.clientId, caseId: form.caseId, action: "case_form.review_comment_added", details: `${form.title}: review comment added${pageNumber ? ` on page ${pageNumber}` : ""}${fieldName ? ` for ${fieldName}` : ""}` });
  await recordFormAudit({ form, event: "ReviewCommentAdded", details: comment, metadata: { pageNumber, fieldName }, userId: req.user.id });
  res.status(201).json({ data });
}

export async function setCaseFormReviewCommentResolution(req, res) {
  await requireFormPermission(req, "canReview");
  const existing = await prisma.caseFormReviewComment.findFirst({ where: caseFormChildAccessWhere(req, { id: req.params.commentId, caseFormId: req.params.id }), include: { caseForm: { select: { clientId: true, caseId: true, title: true } } } });
  if (!existing) throw createHttpError(404, "Review comment not found");
  const resolved = req.body.resolved !== false;
  const data = await prisma.caseFormReviewComment.update({ where: { id: existing.id }, data: resolved ? { resolvedAt: new Date(), resolvedById: req.user.id } : { resolvedAt: null, resolvedById: null }, include: reviewCommentInclude });
  await recordActivity({ agencyId: req.user.agencyId, userId: req.user.id, clientId: existing.caseForm.clientId, caseId: existing.caseForm.caseId, action: resolved ? "case_form.review_comment_resolved" : "case_form.review_comment_reopened", details: `${existing.caseForm.title}: review comment ${resolved ? "resolved" : "reopened"}` });
  res.json({ data });
}

export async function deleteCaseFormReviewComment(req, res) {
  await requireFormPermission(req, "canReview");
  const existing = await prisma.caseFormReviewComment.findFirst({ where: caseFormChildAccessWhere(req, { id: req.params.commentId, caseFormId: req.params.id }), include: { caseForm: { select: { clientId: true, caseId: true, title: true } } } });
  if (!existing) throw createHttpError(404, "Review comment not found");
  await prisma.caseFormReviewComment.delete({ where: { id: existing.id } });
  await recordActivity({ agencyId: req.user.agencyId, userId: req.user.id, clientId: existing.caseForm.clientId, caseId: existing.caseForm.caseId, action: "case_form.review_comment_deleted", details: `${existing.caseForm.title}: review comment deleted` });
  res.status(204).send();
}

export async function deleteCaseForm(req, res) {
  await requireFormPermission(req, "canDelete");
  const existing = await prisma.caseForm.findFirst({ where: caseFormAccessWhere(req, { id: req.params.id }), include: { versions: { select: { storageKey: true } } } });
  if (!existing) throw createHttpError(404, "Case form not found");
  if (existing.lockedAt) throw createHttpError(423, "Unlock the finalized form before deleting it");
  await recordFormAudit({ form: existing, event: "Deleted", details: "Form removed from the case", userId: req.user.id });
  await prisma.caseForm.delete({ where: { id: existing.id } });
  const storageKeys = [...new Set([existing.storageKey, ...existing.versions.map((version) => version.storageKey)].filter(Boolean))];
  await Promise.all(storageKeys.map(removeStoredFile));
  await recordActivity({ agencyId: req.user.agencyId, userId: req.user.id, clientId: existing.clientId, caseId: existing.caseId, action: "case_form.deleted", details: `${existing.title} removed from the case` });
  res.status(204).send();
}

export async function getCurrentFormPermissions(req, res) {
  res.json({ data: await getFormPermissions(req) });
}

export async function updateUserFormPermissions(req, res) {
  if (req.user.role !== "admin") throw createHttpError(403, "Only administrators can change form permissions");
  const user = await prisma.user.findFirst({ where: { id: req.params.userId, agencyId: req.user.agencyId } });
  if (!user) throw createHttpError(404, "User not found");
  const values = Object.fromEntries(formPermissionKeys.filter((key) => req.body[key] !== undefined).map((key) => [key, Boolean(req.body[key])]));
  if (!Object.keys(values).length) throw createHttpError(400, "Provide at least one form permission");
  const data = await prisma.formPermission.upsert({ where: { userId: user.id }, update: values, create: { agencyId: req.user.agencyId, userId: user.id, ...values } });
  await recordActivity({ agencyId: req.user.agencyId, userId: req.user.id, action: "case_form.permissions_updated", details: `Form permissions updated for ${user.fullName}` });
  res.json({ data: Object.fromEntries(formPermissionKeys.map((key) => [key, data[key]])) });
}

export async function finalizeCaseForm(req, res) {
  await requireFormPermission(req, "canFinalize");
  const existing = await prisma.caseForm.findFirst({ where: caseFormAccessWhere(req, { id: req.params.id }) });
  if (!existing) throw createHttpError(404, "Case form not found");
  assertFormUnlocked(existing);
  if (!existing.storageKey) throw createHttpError(409, "A stored form copy is required before finalization");
  if (!["Approved", "Signed"].includes(existing.status)) throw createHttpError(409, "Approve the form or record a signed copy before finalization");
  const openComments = await prisma.caseFormReviewComment.count({ where: { caseFormId: existing.id, resolvedAt: null } });
  if (openComments) throw createHttpError(409, `Resolve ${openComments} open review comment${openComments === 1 ? "" : "s"} before finalization`);
  const lockedAt = new Date();
  const currentSnapshot = await existingSnapshot(existing);
  if (!currentSnapshot) throw createHttpError(404, "The stored form file was not found");
  const data = await prisma.$transaction(async (tx) => {
    await appendVersion(tx, { existing, createdById: req.user.id, snapshot: { ...currentSnapshot, source: "Finalized", copyType: "Finalized" } });
    return tx.caseForm.update({ where: { id: existing.id }, data: { status: "Finalized", currentCopyType: "Finalized", lockedAt, lockedById: req.user.id }, include });
  });
  await recordActivity({ agencyId: req.user.agencyId, userId: req.user.id, clientId: existing.clientId, caseId: existing.caseId, action: "case_form.finalized", details: `${existing.title} finalized and locked by ${req.user.fullName}` });
  await recordFormAudit({ form: data, event: "Finalized", details: `Finalized and locked by ${req.user.fullName}`, userId: req.user.id });
  res.json({ data });
}

export async function unlockCaseForm(req, res) {
  await requireFormPermission(req, "canUnlock");
  const existing = await prisma.caseForm.findFirst({ where: caseFormAccessWhere(req, { id: req.params.id }) });
  if (!existing) throw createHttpError(404, "Case form not found");
  if (!existing.lockedAt) throw createHttpError(409, "This form is not locked");
  const signedVersion = await prisma.caseFormVersion.findFirst({ where: { caseFormId: existing.id, copyType: "ClientSigned" }, select: { id: true } });
  const data = await prisma.caseForm.update({ where: { id: existing.id }, data: { lockedAt: null, lockedById: null, status: signedVersion ? "Signed" : "Approved" }, include });
  await recordActivity({ agencyId: req.user.agencyId, userId: req.user.id, clientId: existing.clientId, caseId: existing.caseId, action: "case_form.unlocked", details: `${existing.title} unlocked by ${req.user.fullName}` });
  await recordFormAudit({ form: data, event: "Unlocked", details: `Unlocked by ${req.user.fullName}`, userId: req.user.id });
  res.json({ data });
}

export async function listCaseFormAudit(req, res) {
  const form = await prisma.caseForm.findFirst({ where: caseFormAccessWhere(req, { id: req.params.id }), select: { id: true } });
  if (!form) throw createHttpError(404, "Case form not found");
  const data = await prisma.caseFormAuditEvent.findMany({ where: { caseFormId: form.id, agencyId: req.user.agencyId }, include: { user: { select: { id: true, fullName: true } } }, orderBy: { createdAt: "desc" }, take: 200 });
  res.json({ data });
}

export async function recordCaseFormAutofill(req, res) {
  await requireFormPermission(req, "canEdit");
  const form = await prisma.caseForm.findFirst({ where: caseFormAccessWhere(req, { id: req.params.id }) });
  if (!form) throw createHttpError(404, "Case form not found");
  assertFormUnlocked(form);
  await recordFormAudit({ form, event: "AutofillApplied", details: `${Number(req.body.fieldCount) || 0} fields applied in the browser`, metadata: { fieldCount: Number(req.body.fieldCount) || 0, mappingVersion: String(req.body.mappingVersion || "") || null }, userId: req.user.id });
  res.status(204).send();
}
