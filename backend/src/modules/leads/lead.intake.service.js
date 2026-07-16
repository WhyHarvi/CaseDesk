import { randomUUID } from "node:crypto";
import prisma from "../../services/prisma/client.js";
import { createHttpError } from "../../utils/http.js";
import { parseCsv } from "./lead.csv.js";
import { inferLeadColumnMapping, normalizeIncomingLead, parseIntakeForm, parsePublicSubmission } from "./lead.intake.validation.js";

const formSelect = {
  id: true, name: true, publicToken: true, isActive: true, requireConsent: true, firstResponseMinutes: true,
  successMessage: true, createdAt: true, updatedAt: true,
  source: { select: { id: true, name: true, type: true } },
  campaign: { select: { id: true, name: true } },
  owner: { select: { id: true, fullName: true } },
};

function page(query = {}) {
  return { take: Math.min(Math.max(Number(query.limit) || 25, 1), 100), skip: (Math.max(Number(query.page) || 1, 1) - 1) * Math.min(Math.max(Number(query.limit) || 25, 1), 100) };
}

async function validateFormReferences(agencyId, values, db = prisma) {
  const [source, owner, campaign] = await Promise.all([
    db.leadSource.findFirst({ where: { id: values.sourceId, agencyId, isActive: true }, select: { id: true } }),
    db.user.findFirst({ where: { id: values.ownerUserId, agencyId, status: "active", memberships: { some: { agencyId, isActive: true, role: { in: ["admin", "consultant", "frontdesk"] } } } }, select: { id: true } }),
    values.campaignId ? db.leadCampaign.findFirst({ where: { id: values.campaignId, agencyId, sourceId: values.sourceId, isActive: true }, select: { id: true } }) : Promise.resolve(null),
  ]);
  if (!source) throw createHttpError(400, "Select an active lead source.", "INVALID_LEAD_SOURCE");
  if (!owner) throw createHttpError(400, "Select an active lead owner.", "INVALID_LEAD_OWNER");
  if (values.campaignId && !campaign) throw createHttpError(400, "The campaign does not match the selected source.", "INVALID_LEAD_CAMPAIGN");
}

export async function listIntakeForms(req) {
  return prisma.leadIntakeForm.findMany({ where: { agencyId: req.auth.agencyId }, select: formSelect, orderBy: { createdAt: "desc" } });
}

export async function createIntakeForm(req) {
  const values = parseIntakeForm(req.body);
  await validateFormReferences(req.auth.agencyId, values);
  return prisma.leadIntakeForm.create({ data: { ...values, agencyId: req.auth.agencyId }, select: formSelect });
}

export async function updateIntakeForm(req) {
  const existing = await prisma.leadIntakeForm.findFirst({ where: { id: req.params.formId, agencyId: req.auth.agencyId } });
  if (!existing) throw createHttpError(404, "Intake form not found.", "INTAKE_FORM_NOT_FOUND");
  const data = {};
  if (typeof req.body.isActive === "boolean") data.isActive = req.body.isActive;
  if (typeof req.body.requireConsent === "boolean") data.requireConsent = req.body.requireConsent;
  if (req.body.name || req.body.sourceId || req.body.ownerUserId || req.body.firstResponseMinutes) {
    const values = parseIntakeForm({ ...existing, ...req.body });
    await validateFormReferences(req.auth.agencyId, values);
    Object.assign(data, values);
    delete data.publicToken;
  }
  return prisma.leadIntakeForm.update({ where: { id: existing.id }, data, select: formSelect });
}

export async function getPublicIntake(token) {
  const form = await prisma.leadIntakeForm.findUnique({
    where: { publicToken: String(token || "") },
    select: { name: true, isActive: true, requireConsent: true, successMessage: true, agency: { select: { name: true, logoUrl: true } } },
  });
  if (!form?.isActive) throw createHttpError(404, "This intake form is not available.", "INTAKE_FORM_NOT_FOUND");
  return { name: form.name, requireConsent: form.requireConsent, successMessage: form.successMessage, agency: form.agency };
}

export async function submitPublicIntake(req) {
  const form = await prisma.leadIntakeForm.findUnique({ where: { publicToken: String(req.params.token || "") } });
  if (!form?.isActive) throw createHttpError(404, "This intake form is not available.", "INTAKE_FORM_NOT_FOUND");
  const values = parsePublicSubmission(req.body, form.requireConsent);
  if (values.bot) return { accepted: true, reference: null, message: form.successMessage };
  const suppliedKey = String(req.get("Idempotency-Key") || "").trim().slice(0, 200);
  const idempotencyKey = suppliedKey ? `public:${form.id}:${suppliedKey}` : `public:${form.id}:${randomUUID()}`;
  const tracking = Object.fromEntries(["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "ref"].map((key) => [key, String(req.query[key] || "").trim().slice(0, 200)]).filter(([, value]) => value));
  let campaignId = form.campaignId;
  if (req.query.campaign) {
    const campaignKey = String(req.query.campaign).trim().slice(0, 200);
    const approvedCampaign = await prisma.leadCampaign.findFirst({ where: { agencyId: form.agencyId, sourceId: form.sourceId, isActive: true, OR: [{ id: campaignKey }, { externalId: campaignKey }, { name: campaignKey }] }, select: { id: true } });
    if (approvedCampaign) campaignId = approvedCampaign.id;
  }
  try {
    const event = await prisma.leadIncomingEvent.create({ data: {
      agencyId: form.agencyId, sourceId: form.sourceId, campaignId, intakeFormId: form.id,
      channel: "PUBLIC_FORM", idempotencyKey, rawPayload: { ...values.rawPayload, ...(Object.keys(tracking).length ? { tracking } : {}) },
    }, select: { id: true } });
    return { accepted: true, reference: event.id, message: form.successMessage };
  } catch (error) {
    if (error?.code !== "P2002" || !suppliedKey) throw error;
    const event = await prisma.leadIncomingEvent.findFirst({ where: { agencyId: form.agencyId, idempotencyKey }, select: { id: true } });
    return { accepted: true, reference: event?.id || null, message: form.successMessage };
  }
}

function parseMapping(raw, inferred) {
  if (!raw) return inferred;
  try { return { ...inferred, ...(typeof raw === "string" ? JSON.parse(raw) : raw) }; }
  catch { throw createHttpError(400, "Column mapping is invalid.", "INVALID_COLUMN_MAPPING"); }
}

export async function previewImport(req) {
  if (!req.file) throw createHttpError(400, "Choose a CSV file to preview.", "CSV_REQUIRED");
  const sourceId = String(req.body.sourceId || "");
  const ownerUserId = String(req.body.ownerUserId || req.auth.userId);
  await validateFormReferences(req.auth.agencyId, { sourceId, ownerUserId, campaignId: null });
  const parsed = parseCsv(req.file.buffer.toString("utf8"));
  if (parsed.rows.length > 5000) throw createHttpError(400, "CSV imports are limited to 5,000 rows.", "CSV_TOO_LARGE");
  const mapping = parseMapping(req.body.mapping, inferLeadColumnMapping(parsed.headers));
  if (!mapping.phone) throw createHttpError(400, "Map a CSV column to Phone before previewing.", "PHONE_COLUMN_REQUIRED");
  const prepared = parsed.rows.map((rawData, index) => {
    const normalized = normalizeIncomingLead(rawData, mapping);
    return { agencyId: req.auth.agencyId, rowNumber: index + 2, rawData, normalizedData: normalized.data, validationErrors: normalized.errors, status: normalized.errors.length ? "INVALID" : "VALID" };
  });
  const validRows = prepared.filter((row) => row.status === "VALID").length;
  const batch = await prisma.leadImportBatch.create({
    data: {
      agencyId: req.auth.agencyId, sourceId, uploadedById: req.auth.userId, fileName: req.file.originalname.slice(0, 255),
      totalRows: prepared.length, validRows, invalidRows: prepared.length - validRows,
      settings: { ownerUserId, mapping, headers: parsed.headers }, rows: { create: prepared },
    },
    include: { source: { select: { id: true, name: true } }, rows: { orderBy: { rowNumber: "asc" }, take: 100 } },
  });
  return batch;
}

export async function listImports(req) {
  const paging = page(req.query);
  return prisma.leadImportBatch.findMany({ where: { agencyId: req.auth.agencyId }, ...paging, orderBy: { createdAt: "desc" }, include: { source: { select: { id: true, name: true } }, uploadedBy: { select: { id: true, fullName: true } } } });
}

export async function getImport(req) {
  const batch = await prisma.leadImportBatch.findFirst({ where: { id: req.params.batchId, agencyId: req.auth.agencyId }, include: { source: { select: { id: true, name: true } }, uploadedBy: { select: { id: true, fullName: true } }, rows: { orderBy: { rowNumber: "asc" }, take: 500 } } });
  if (!batch) throw createHttpError(404, "Import batch not found.", "IMPORT_NOT_FOUND");
  return batch;
}

export async function commitImport(req) {
  const batch = await prisma.leadImportBatch.findFirst({ where: { id: req.params.batchId, agencyId: req.auth.agencyId }, include: { rows: { where: { status: "VALID" }, select: { id: true, rawData: true, rowNumber: true } } } });
  if (!batch) throw createHttpError(404, "Import batch not found.", "IMPORT_NOT_FOUND");
  if (batch.status !== "PREVIEW") throw createHttpError(409, "This import has already been committed.", "IMPORT_ALREADY_COMMITTED");
  if (!batch.rows.length) throw createHttpError(400, "This import has no valid rows.", "NO_VALID_IMPORT_ROWS");
  await prisma.$transaction([
    prisma.leadIncomingEvent.createMany({ data: batch.rows.map((row) => ({
      agencyId: batch.agencyId, sourceId: batch.sourceId, importBatchId: batch.id, importRowId: row.id,
      channel: "CSV_IMPORT", idempotencyKey: `csv:${batch.id}:${row.rowNumber}`, rawPayload: row.rawData,
    })) }),
    prisma.leadImportRow.updateMany({ where: { batchId: batch.id, status: "VALID" }, data: { status: "QUEUED" } }),
    prisma.leadImportBatch.update({ where: { id: batch.id }, data: { status: "QUEUED", committedAt: new Date() } }),
    prisma.activityLog.create({ data: { agencyId: batch.agencyId, userId: req.auth.userId, action: "lead.import_committed", details: `${batch.fileName}: ${batch.rows.length} valid rows`, entityType: "lead_import_batch", entityId: batch.id } }),
  ]);
  return getImport({ ...req, params: { batchId: batch.id } });
}

export async function listIncomingEvents(req) {
  const paging = page(req.query);
  const where = { agencyId: req.auth.agencyId, ...(req.query.status ? { status: String(req.query.status) } : {}) };
  return prisma.leadIncomingEvent.findMany({ where, ...paging, orderBy: { createdAt: "desc" }, include: {
    source: { select: { id: true, name: true } }, intakeForm: { select: { id: true, name: true } },
    processedLead: { select: { id: true, leadNumber: true, firstName: true, lastName: true } },
    duplicateCandidates: { include: { candidateLead: { select: { id: true, leadNumber: true, firstName: true, lastName: true, phone: true, email: true } } } },
  } });
}

export async function getIntakeOperations(req) {
  if (req.auth.role !== "admin") throw createHttpError(403, "Only administrators can view intake operations.", "FORBIDDEN");
  const agencyId = req.auth.agencyId;
  const [statusGroups, oldestPending, recentFailures, activeConnections] = await Promise.all([
    prisma.leadIncomingEvent.groupBy({ by: ["status"], where: { agencyId }, _count: { _all: true } }),
    prisma.leadIncomingEvent.findFirst({ where: { agencyId, status: "PENDING" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    prisma.leadIncomingEvent.findMany({ where: { agencyId, status: "FAILED" }, orderBy: { updatedAt: "desc" }, take: 10, select: { id: true, channel: true, lastError: true, attempts: true, createdAt: true } }),
    prisma.leadSourceConnection.count({ where: { agencyId, isActive: true } }),
  ]);
  const counts = Object.fromEntries(statusGroups.map((item) => [item.status, item._count._all]));
  return { counts, activeConnections, oldestPendingSeconds: oldestPending ? Math.max(0, Math.round((Date.now() - oldestPending.createdAt.getTime()) / 1000)) : 0, recentFailures };
}

export async function retryIncomingEvent(req) {
  if (req.auth.role !== "admin") throw createHttpError(403, "Only administrators can retry failed events.", "FORBIDDEN");
  const event = await prisma.leadIncomingEvent.findFirst({ where: { id: req.params.eventId, agencyId: req.auth.agencyId, status: "FAILED" }, select: { id: true, importRowId: true } });
  if (!event) throw createHttpError(404, "Failed incoming event not found.", "EVENT_NOT_FOUND");
  await prisma.$transaction([
    prisma.leadIncomingEvent.update({ where: { id: event.id }, data: { status: "PENDING", attempts: 0, availableAt: new Date(), lockedAt: null, processedAt: null, lastError: null } }),
    ...(event.importRowId ? [prisma.leadImportRow.update({ where: { id: event.importRowId }, data: { status: "QUEUED", validationErrors: [] } })] : []),
    prisma.activityLog.create({ data: { agencyId: req.auth.agencyId, userId: req.auth.userId, action: "lead.incoming_event_retried", entityType: "lead_incoming_event", entityId: event.id } }),
  ]);
  return { id: event.id, status: "PENDING" };
}
