import prisma from "./prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";

export const PORTAL_PERMISSION_GROUPS = Object.freeze({
  general: ["access"],
  dashboard: ["view_case_status", "view_stage", "view_progress", "view_next_action", "view_assigned_consultant", "view_staff_names", "view_important_dates", "view_activity_timeline"],
  documents: ["view", "upload", "replace_own", "delete_own", "download_approved", "download_finalized", "preview", "view_staff_uploaded", "view_internal", "view_rejected", "view_review_status", "respond_changes_requested"],
  forms: ["view", "edit", "submit", "edit_after_submission", "download_submitted", "view_review_status", "edit_until_locked"],
  case_information: ["view", "edit_personal", "edit_contact", "edit_passport", "edit_immigration_history", "edit_employment_history", "edit_education_history", "edit_family"],
  payments: ["view_balance", "view_invoice_breakdown", "view_history", "download_invoices", "download_receipts", "make_payment", "view_plan", "view_overdue"],
  appointments: ["view", "request", "reschedule", "cancel", "book", "view_availability"],
  communication: ["message_consultant", "message_agency", "reply", "upload_attachments", "create_conversation", "view_history"],
  notifications: ["documents_requested", "document_approved", "changes_requested", "form_assigned", "payment_due", "payment_received", "appointment_reminder", "case_stage_change", "new_message", "case_update"],
});

export const PORTAL_PERMISSION_KEYS = Object.freeze(Object.entries(PORTAL_PERMISSION_GROUPS).flatMap(([group, keys]) => keys.map((key) => `${group}.${key}`)));
const KEY_SET = new Set(PORTAL_PERMISSION_KEYS);
const IMMUTABLE_DENY = new Set(["documents.view_internal"]);
const RESTRICTED_ALLOW = new Set(["general.access", "dashboard.view_case_status", "documents.view", "documents.upload", "forms.view", "forms.edit", "forms.submit", "appointments.view", "communication.reply", "communication.view_history"]);

const baseStandard = Object.fromEntries(PORTAL_PERMISSION_KEYS.map((key) => [key, true]));
Object.assign(baseStandard, {
  "dashboard.view_staff_names": false,
  "documents.delete_own": false,
  "documents.view_internal": false,
  "documents.view_rejected": false,
  "forms.edit_after_submission": false,
  "case_information.edit_passport": false,
  "case_information.edit_immigration_history": false,
  "case_information.edit_employment_history": false,
  "case_information.edit_education_history": false,
  "case_information.edit_family": false,
  "appointments.reschedule": false,
  "appointments.cancel": false,
});

const readonly = Object.fromEntries(PORTAL_PERMISSION_KEYS.map((key) => [key, !/(upload|replace|delete|edit|submit|make_payment|request|reschedule|cancel|book|message|reply|create_conversation)/.test(key)]));
const documentsOnly = Object.fromEntries(PORTAL_PERMISSION_KEYS.map((key) => [key, key === "general.access" || key.startsWith("documents.") && !["documents.delete_own", "documents.view_internal", "documents.view_rejected"].includes(key)]));
const restricted = Object.fromEntries(PORTAL_PERMISSION_KEYS.map((key) => [key, RESTRICTED_ALLOW.has(key)]));
const full = { ...baseStandard, "case_information.edit_passport": true, "case_information.edit_immigration_history": true, "case_information.edit_employment_history": true, "case_information.edit_education_history": true, "case_information.edit_family": true, "appointments.reschedule": true, "appointments.cancel": true };

export const PORTAL_PRESETS = Object.freeze({ STANDARD: baseStandard, RESTRICTED: restricted, DOCUMENTS_ONLY: documentsOnly, READ_ONLY: readonly, FULL: full });

function activeWindow(policy, now) {
  return policy && (!policy.validFrom || policy.validFrom <= now) && (!policy.validUntil || policy.validUntil > now);
}

function normalizeEntry(value) {
  if (typeof value === "boolean") return { value: value ? "ALLOW" : "DENY" };
  if (!value || typeof value !== "object") return null;
  const setting = ["ALLOW", "DENY", "INHERIT"].includes(value.value) ? value.value : "INHERIT";
  const from = value.validFrom ? new Date(value.validFrom) : null;
  const until = value.validUntil ? new Date(value.validUntil) : null;
  return { value: setting, validFrom: from && !Number.isNaN(from.valueOf()) ? from : null, validUntil: until && !Number.isNaN(until.valueOf()) ? until : null };
}

function entryActive(entry, now) {
  return entry && (!entry.validFrom || entry.validFrom <= now) && (!entry.validUntil || entry.validUntil > now);
}

function scopedValue(policy, key, now) {
  if (!activeWindow(policy, now)) return null;
  const entry = normalizeEntry(policy.permissions?.[key]);
  return entryActive(entry, now) && entry.value !== "INHERIT" ? entry.value : null;
}

function scopedVeto(policy, key, now) {
  if (!activeWindow(policy, now)) return null;
  const raw = policy.vetoes?.[key];
  const entry = typeof raw === "string" ? { value: raw } : raw;
  if (!entry || typeof entry !== "object") return null;
  const from = entry.validFrom ? new Date(entry.validFrom) : null;
  const until = entry.validUntil ? new Date(entry.validUntil) : null;
  if ((from && from > now) || (until && until <= now)) return null;
  return ["FORCE_ALLOW", "FORCE_DENY"].includes(entry.value) ? entry.value : null;
}

export function resolvePermissionFromPolicies({ key, agencyPolicy, casePolicy, clientPolicy, now = new Date() }) {
  if (!KEY_SET.has(key)) return { allowed: false, effective: "DENY", source: "UNKNOWN_PERMISSION", trace: [] };
  if (IMMUTABLE_DENY.has(key)) return { allowed: false, effective: "DENY", source: "SECURITY_CEILING", trace: [{ layer: "Security ceiling", value: "DENY" }] };
  const preset = PORTAL_PRESETS[agencyPolicy?.preset] || PORTAL_PRESETS.STANDARD;
  const trace = [{ layer: "Agency default", value: scopedValue(agencyPolicy, key, now) || (preset[key] ? "ALLOW" : "DENY") }];
  let effective = trace[0].value;
  for (const [label, policy] of [["Case override", casePolicy], ["Client override", clientPolicy]]) {
    const value = scopedValue(policy, key, now);
    trace.push({ layer: label, value: value || "INHERIT" });
    if (value) effective = value;
  }
  const vetoes = [agencyPolicy, casePolicy, clientPolicy].map((policy) => scopedVeto(policy, key, now)).filter(Boolean);
  const veto = vetoes.includes("FORCE_DENY") ? "FORCE_DENY" : vetoes.includes("FORCE_ALLOW") ? "FORCE_ALLOW" : "NONE";
  trace.push({ layer: "Administrative veto", value: veto });
  if (veto === "FORCE_DENY") effective = "DENY";
  else if (veto === "FORCE_ALLOW") effective = "ALLOW";
  const statuses = [agencyPolicy, casePolicy, clientPolicy].filter((item) => activeWindow(item, now)).map((item) => item.status);
  if (statuses.includes("SUSPENDED")) return { allowed: false, effective: "DENY", source: "PORTAL_SUSPENDED", trace };
  if (statuses.includes("RESTRICTED") && !RESTRICTED_ALLOW.has(key)) return { allowed: false, effective: "DENY", source: "PORTAL_RESTRICTED", trace };
  return { allowed: effective === "ALLOW", effective, source: veto !== "NONE" ? "ADMIN_VETO" : [...trace].reverse().find((item) => !["INHERIT", "NONE"].includes(item.value))?.layer || "Agency default", trace };
}

export async function loadPortalPolicyContext({ agencyId, clientUserId, clientId, caseId = null }) {
  const clientLink = clientUserId ? await prisma.clientUser.findFirst({ where: { id: clientUserId, agencyId }, select: { id: true, clientId: true } }) : await prisma.clientUser.findFirst({ where: { agencyId, clientId }, orderBy: { isPrimary: "desc" }, select: { id: true, clientId: true } });
  if (!clientLink) throw createHttpError(404, "Client portal profile not found.", "NOT_FOUND");
  if (caseId) {
    const validCase = await prisma.case.findFirst({ where: { id: caseId, agencyId, clientId: clientLink.clientId }, select: { id: true } });
    if (!validCase) throw createHttpError(404, "Application not found.", "NOT_FOUND");
  }
  const scopeIds = [agencyId, ...(caseId ? [caseId] : []), clientLink.id];
  const policies = await prisma.portalAccessPolicy.findMany({ where: { agencyId, scopeId: { in: scopeIds } } });
  return {
    clientLink,
    agencyPolicy: policies.find((item) => item.scope === "AGENCY" && item.scopeId === agencyId) || null,
    casePolicy: policies.find((item) => item.scope === "CASE" && item.scopeId === caseId) || null,
    clientPolicy: policies.find((item) => item.scope === "CLIENT_USER" && item.scopeId === clientLink.id) || null,
  };
}

export async function resolvePortalPermission(input) {
  const context = await loadPortalPolicyContext(input);
  return { ...resolvePermissionFromPolicies({ key: input.key, ...context }), context };
}

export async function filterPortalRecordsByPermission({ agencyId, clientUserId, key, records, caseIdOf = (item) => item.caseId }) {
  const caseIds = [...new Set(records.map(caseIdOf).filter(Boolean))];
  const policies = await prisma.portalAccessPolicy.findMany({ where: { agencyId, OR: [{ scope: "AGENCY", scopeId: agencyId }, { scope: "CLIENT_USER", scopeId: clientUserId }, ...(caseIds.length ? [{ scope: "CASE", scopeId: { in: caseIds } }] : [])] } });
  const agencyPolicy = policies.find((item) => item.scope === "AGENCY") || null;
  const clientPolicy = policies.find((item) => item.scope === "CLIENT_USER" && item.scopeId === clientUserId) || null;
  return records.filter((item) => resolvePermissionFromPolicies({ key, agencyPolicy, clientPolicy, casePolicy: policies.find((policy) => policy.scope === "CASE" && policy.scopeId === caseIdOf(item)) || null }).allowed);
}

function cleanMap(input, allowedValues) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  return Object.fromEntries(Object.entries(source).filter(([key, entry]) => KEY_SET.has(key) && entry && typeof entry === "object" && allowedValues.includes(entry.value)).map(([key, entry]) => [key, { value: entry.value, ...(entry.validFrom ? { validFrom: entry.validFrom } : {}), ...(entry.validUntil ? { validUntil: entry.validUntil } : {}) }]));
}

export async function savePortalPolicy({ agencyId, actorUserId, scope, scopeId, preset, status, permissions, vetoes, validFrom, validUntil }) {
  if (!Object.hasOwn(PORTAL_PRESETS, preset)) preset = "CUSTOM";
  if (!["ACTIVE", "RESTRICTED", "SUSPENDED"].includes(status)) throw createHttpError(400, "Choose a valid portal status.", "VALIDATION_ERROR");
  if (scope === "AGENCY" && scopeId !== agencyId) throw createHttpError(403, "Invalid agency policy scope.", "FORBIDDEN");
  if (scope === "CASE" && !(await prisma.case.findFirst({ where: { id: scopeId, agencyId }, select: { id: true } }))) throw createHttpError(404, "Case not found.", "NOT_FOUND");
  if (scope === "CLIENT_USER" && !(await prisma.clientUser.findFirst({ where: { id: scopeId, agencyId }, select: { id: true } }))) throw createHttpError(404, "Portal user not found.", "NOT_FOUND");
  const parsedFrom = validFrom ? new Date(validFrom) : null;
  const parsedUntil = validUntil ? new Date(validUntil) : null;
  if ((parsedFrom && Number.isNaN(parsedFrom.valueOf())) || (parsedUntil && Number.isNaN(parsedUntil.valueOf())) || (parsedFrom && parsedUntil && parsedUntil <= parsedFrom)) throw createHttpError(400, "Choose a valid access window. The expiry must be after the start date.", "VALIDATION_ERROR");
  const existing = await prisma.portalAccessPolicy.findUnique({ where: { agencyId_scope_scopeId: { agencyId, scope, scopeId } } });
  const data = { preset, status, permissions: cleanMap(permissions, ["INHERIT", "ALLOW", "DENY"]), vetoes: cleanMap(vetoes, ["NONE", "FORCE_ALLOW", "FORCE_DENY"]), validFrom: parsedFrom, validUntil: parsedUntil, updatedById: actorUserId };
  const saved = await prisma.portalAccessPolicy.upsert({ where: { agencyId_scope_scopeId: { agencyId, scope, scopeId } }, create: { agencyId, scope, scopeId, ...data }, update: data });
  await recordActivity({ agencyId, userId: actorUserId, caseId: scope === "CASE" ? scopeId : null, clientId: scope === "CLIENT_USER" ? (await prisma.clientUser.findFirst({ where: { id: scopeId, agencyId }, select: { clientId: true } }))?.clientId : null, action: "CLIENT_PORTAL_POLICY_CHANGED", details: `${scope.replace("_", " ")} portal policy updated`, entityType: "portal_access_policy", entityId: saved.id, metadata: { scope, scopeId, previous: existing ? { preset: existing.preset, status: existing.status, permissions: existing.permissions, vetoes: existing.vetoes } : null, next: { preset, status, permissions: saved.permissions, vetoes: saved.vetoes } } });
  return saved;
}

export function portalPolicyCatalog() {
  return { groups: PORTAL_PERMISSION_GROUPS, presets: Object.keys(PORTAL_PRESETS), immutableDenied: [...IMMUTABLE_DENY] };
}
