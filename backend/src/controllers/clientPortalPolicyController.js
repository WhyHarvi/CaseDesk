import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import {
  loadPortalPolicyContext,
  portalPolicyCatalog,
  PORTAL_PERMISSION_KEYS,
  resolvePermissionFromPolicies,
  savePortalPolicy,
} from "../services/clientPortalPolicyService.js";

function effectiveMap(context) {
  return Object.fromEntries(PORTAL_PERMISSION_KEYS.map((key) => [key, resolvePermissionFromPolicies({ key, ...context })]));
}

function policyBody(req, { allowVeto = false, allowSuspension = false } = {}) {
  const body = req.body || {};
  return {
    preset: String(body.preset || "CUSTOM").toUpperCase(),
    status: allowSuspension ? String(body.status || "ACTIVE").toUpperCase() : String(body.status || "ACTIVE").toUpperCase() === "SUSPENDED" ? "RESTRICTED" : String(body.status || "ACTIVE").toUpperCase(),
    permissions: body.permissions || {},
    vetoes: allowVeto ? body.vetoes || {} : {},
    validFrom: body.validFrom || null,
    validUntil: body.validUntil || null,
  };
}

export function getPortalPermissionCatalog(_req, res) {
  res.json({ data: portalPolicyCatalog() });
}

export async function getAgencyPortalPolicy(req, res) {
  const context = { agencyPolicy: await prisma.portalAccessPolicy.findUnique({ where: { agencyId_scope_scopeId: { agencyId: req.auth.agencyId, scope: "AGENCY", scopeId: req.auth.agencyId } } }), casePolicy: null, clientPolicy: null };
  res.json({ data: { policy: context.agencyPolicy, effective: effectiveMap(context), catalog: portalPolicyCatalog() } });
}

export async function putAgencyPortalPolicy(req, res) {
  const policy = await savePortalPolicy({ agencyId: req.auth.agencyId, actorUserId: req.auth.userId, scope: "AGENCY", scopeId: req.auth.agencyId, ...policyBody(req, { allowVeto: true, allowSuspension: true }) });
  res.json({ data: policy, message: "Agency client portal defaults saved." });
}

async function primaryPortalUser(agencyId, clientId) {
  return prisma.clientUser.findFirst({ where: { agencyId, clientId }, orderBy: { isPrimary: "desc" }, select: { id: true, clientId: true, user: { select: { fullName: true, email: true, status: true } } } });
}

export async function getCasePortalPolicy(req, res) {
  const caseItem = await prisma.case.findFirst({ where: { id: req.params.id, agencyId: req.auth.agencyId }, select: { id: true, clientId: true } });
  if (!caseItem) throw createHttpError(404, "Case not found.", "NOT_FOUND");
  const link = await primaryPortalUser(req.auth.agencyId, caseItem.clientId);
  if (!link) return res.json({ data: { portalUser: null, policy: null, effective: null, catalog: portalPolicyCatalog() } });
  const context = await loadPortalPolicyContext({ agencyId: req.auth.agencyId, clientUserId: link.id, caseId: caseItem.id });
  res.json({ data: { portalUser: link, policy: context.casePolicy, effective: effectiveMap(context), catalog: portalPolicyCatalog() } });
}

export async function putCasePortalPolicy(req, res) {
  const values = policyBody(req, { allowVeto: req.auth.role === "admin", allowSuspension: req.auth.role === "admin" });
  if (req.auth.role !== "admin") {
    const existing = await prisma.portalAccessPolicy.findUnique({ where: { agencyId_scope_scopeId: { agencyId: req.auth.agencyId, scope: "CASE", scopeId: req.params.id } }, select: { vetoes: true, status: true } });
    values.vetoes = existing?.vetoes || {};
    if (existing?.status === "SUSPENDED") values.status = "SUSPENDED";
  }
  const policy = await savePortalPolicy({ agencyId: req.auth.agencyId, actorUserId: req.auth.userId, scope: "CASE", scopeId: req.params.id, ...values });
  res.json({ data: policy, message: "Case portal policy saved." });
}

export async function resetCasePortalPolicy(req, res) {
  const existing = await prisma.portalAccessPolicy.findUnique({ where: { agencyId_scope_scopeId: { agencyId: req.auth.agencyId, scope: "CASE", scopeId: req.params.id } }, select: { id: true, vetoes: true, status: true } });
  if (req.auth.role !== "admin" && existing && (existing.status === "SUSPENDED" || Object.values(existing.vetoes || {}).some((item) => ["FORCE_ALLOW", "FORCE_DENY"].includes(item?.value)))) {
    throw createHttpError(403, "An administrator must remove the active portal veto or suspension.", "FORBIDDEN");
  }
  if (existing) {
    await prisma.portalAccessPolicy.delete({ where: { id: existing.id } });
    await recordActivity({ agencyId: req.auth.agencyId, userId: req.auth.userId, caseId: req.params.id, action: "CLIENT_PORTAL_CASE_POLICY_RESET", details: "Case portal overrides reset to agency defaults", entityType: "case", entityId: req.params.id });
  }
  res.json({ data: null, message: "Case policy reset to agency defaults." });
}

export async function getClientPortalPolicy(req, res) {
  const link = await primaryPortalUser(req.auth.agencyId, req.params.clientId);
  if (!link) throw createHttpError(404, "This client does not have a portal account yet.", "NOT_FOUND");
  const context = await loadPortalPolicyContext({ agencyId: req.auth.agencyId, clientUserId: link.id });
  res.json({ data: { portalUser: link, policy: context.clientPolicy, effective: effectiveMap(context), catalog: portalPolicyCatalog() } });
}

export async function putClientPortalPolicy(req, res) {
  const link = await primaryPortalUser(req.auth.agencyId, req.params.clientId);
  if (!link) throw createHttpError(404, "This client does not have a portal account yet.", "NOT_FOUND");
  const values = policyBody(req, { allowVeto: req.auth.role === "admin", allowSuspension: req.auth.role === "admin" });
  if (req.auth.role !== "admin") {
    const existing = await prisma.portalAccessPolicy.findUnique({ where: { agencyId_scope_scopeId: { agencyId: req.auth.agencyId, scope: "CLIENT_USER", scopeId: link.id } }, select: { vetoes: true, status: true } });
    values.vetoes = existing?.vetoes || {};
    if (existing?.status === "SUSPENDED") values.status = "SUSPENDED";
  }
  const policy = await savePortalPolicy({ agencyId: req.auth.agencyId, actorUserId: req.auth.userId, scope: "CLIENT_USER", scopeId: link.id, ...values });
  res.json({ data: policy, message: "Client portal policy saved." });
}
