import prisma from "../services/prisma/client.js";
import { requireLead } from "../modules/leads/lead.repository.js";
import { caseAccessWhere } from "../middleware/authorization.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";

const STATUSES = new Set(["Unpaid", "Partially Paid", "Paid"]);

function parseEntry(body) {
  const label = String(body?.label || "").trim().slice(0, 200);
  if (!label) throw createHttpError(400, "A label is required.", "VALIDATION_ERROR");
  const amountOwed = Number(body?.amountOwed ?? 0);
  const amountPaid = Number(body?.amountPaid ?? 0);
  if (!Number.isFinite(amountOwed) || amountOwed < 0) throw createHttpError(400, "Amount owed must be a positive number.", "VALIDATION_ERROR");
  if (!Number.isFinite(amountPaid) || amountPaid < 0) throw createHttpError(400, "Amount paid must be a positive number.", "VALIDATION_ERROR");
  const status = STATUSES.has(body?.status) ? body.status : amountPaid <= 0 ? "Unpaid" : amountPaid >= amountOwed ? "Paid" : "Partially Paid";
  const note = body?.note ? String(body.note).trim().slice(0, 2000) : null;
  return { label, amountOwed, amountPaid, status, note };
}

async function requireCaseForLedger(req) {
  const kase = await prisma.case.findFirst({
    where: { id: req.params.id, agencyId: req.auth.agencyId, ...caseAccessWhere(req) },
    select: { id: true, clientId: true },
  });
  if (!kase) throw createHttpError(404, "Case not found.", "CASE_NOT_FOUND");
  return kase;
}

export async function listLeadLedgerEntries(req, res) {
  const lead = await requireLead(prisma, req, req.params.leadId);
  const data = await prisma.caseManualLedgerEntry.findMany({ where: { agencyId: req.auth.agencyId, leadId: lead.id }, orderBy: { createdAt: "asc" } });
  res.json({ data });
}

export async function createLeadLedgerEntry(req, res) {
  const lead = await requireLead(prisma, req, req.params.leadId);
  const values = parseEntry(req.body);
  const entry = await prisma.caseManualLedgerEntry.create({ data: { ...values, agencyId: req.auth.agencyId, leadId: lead.id, createdById: req.auth.userId } });
  await recordActivity({ agencyId: req.auth.agencyId, userId: req.auth.userId, action: "lead.ledger_entry_added", details: `${lead.leadNumber}: ${values.label} ($${values.amountOwed})`, entityType: "lead", entityId: lead.id });
  res.status(201).json({ data: entry });
}

export async function listCaseLedgerEntries(req, res) {
  const kase = await requireCaseForLedger(req);
  const data = await prisma.caseManualLedgerEntry.findMany({ where: { agencyId: req.auth.agencyId, caseId: kase.id }, orderBy: { createdAt: "asc" } });
  res.json({ data });
}

export async function createCaseLedgerEntry(req, res) {
  const kase = await requireCaseForLedger(req);
  const values = parseEntry(req.body);
  const entry = await prisma.caseManualLedgerEntry.create({ data: { ...values, agencyId: req.auth.agencyId, caseId: kase.id, clientId: kase.clientId, createdById: req.auth.userId } });
  await recordActivity({ agencyId: req.auth.agencyId, userId: req.auth.userId, action: "case.ledger_entry_added", details: `${values.label} ($${values.amountOwed})`, entityType: "case", entityId: kase.id });
  res.status(201).json({ data: entry });
}

async function requireLedgerEntry(req) {
  const entry = await prisma.caseManualLedgerEntry.findFirst({ where: { id: req.params.entryId, agencyId: req.auth.agencyId } });
  if (!entry) throw createHttpError(404, "Ledger entry not found.", "LEDGER_ENTRY_NOT_FOUND");
  if (entry.leadId) await requireLead(prisma, req, entry.leadId);
  else if (entry.caseId) {
    const allowed = await prisma.case.findFirst({ where: { id: entry.caseId, agencyId: req.auth.agencyId, ...caseAccessWhere(req) }, select: { id: true } });
    if (!allowed) throw createHttpError(404, "Ledger entry not found.", "LEDGER_ENTRY_NOT_FOUND");
  }
  return entry;
}

export async function updateLedgerEntry(req, res) {
  const existing = await requireLedgerEntry(req);
  // Explicit status in the request wins; otherwise recompute from the
  // (possibly just-changed) amounts rather than silently keeping the old
  // status — spreading `existing` first would otherwise always satisfy the
  // "explicit status" check in parseEntry with the stale value.
  const values = parseEntry({ ...existing, ...req.body, status: req.body?.status ?? undefined });
  const entry = await prisma.caseManualLedgerEntry.update({ where: { id: existing.id }, data: values });
  res.json({ data: entry });
}

export async function deleteLedgerEntry(req, res) {
  const existing = await requireLedgerEntry(req);
  await prisma.caseManualLedgerEntry.delete({ where: { id: existing.id } });
  res.status(204).send();
}
