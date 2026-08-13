// Rule-based lead auto-assignment. Admin-defined rules route a fresh lead to
// a specific person based on its attributes (e.g. "Study Permit -> Manpreet")
// instead of it landing on whoever happens to own the intake form/connector.
// Real data check that shaped this: immigrationInterest is blank on most
// open leads and inconsistent when present ("Study permit" / "study permit"
// / "Study p"), while initialMessage (the raw inquiry text) has ~94%
// coverage — so substring matching runs against the free text, not just the
// sparse structured field.
import prisma from "../../services/prisma/client.js";
import { createHttpError } from "../../utils/http.js";
import { requireLeadStaff } from "./lead.service.js";

const SUBSTRING_FIELDS = new Set(["initialMessage", "immigrationInterest"]);
const EXACT_FIELDS = new Set(["province", "preferredLanguage", "priority", "originalSourceType"]);
export const ROUTING_RULE_FIELDS = [...SUBSTRING_FIELDS, ...EXACT_FIELDS];

// A substring condition's value can be a comma-separated list of
// alternative keywords/phrases (e.g. "study, study permit, student visa") —
// it matches if ANY of them appears in the target text. Different
// conditions on the same rule still AND together; this only adds OR
// semantics within a single condition's value, which is the natural way an
// admin writes "any of these phrases means this rule fires."
function conditionMatches({ field, value }, context) {
  const target = context[field];
  if (target == null || target === "" || value == null || value === "") return false;
  if (SUBSTRING_FIELDS.has(field)) {
    const haystack = String(target).toLowerCase();
    const needles = String(value).split(",").map((part) => part.trim().toLowerCase()).filter(Boolean);
    return needles.some((needle) => haystack.includes(needle));
  }
  if (EXACT_FIELDS.has(field)) return String(target).trim().toLowerCase() === String(value).trim().toLowerCase();
  return false;
}

function ruleMatches(rule, context) {
  const conditions = Array.isArray(rule.conditions) ? rule.conditions : [];
  if (!conditions.length) return false;
  return conditions.every((condition) => conditionMatches(condition, context));
}

// Pure, DB-free. Returns every active rule whose conditions all match,
// ordered by sortOrder — the caller decides how many candidates it needs.
// A rule with zero conditions never matches anything, so an empty rule can
// never silently swallow every lead.
export function matchLeadRoutingRules(rules, attrs, sourceType) {
  const context = { ...attrs, originalSourceType: sourceType };
  return rules
    .filter((rule) => rule.isActive)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .filter((rule) => ruleMatches(rule, context));
}

// DB-touching wrapper for use inside an existing transaction. Walks matches
// in sortOrder, skipping any whose target has gone inactive since the rule
// was set up — so a stale rule can never block lead creation, it just falls
// through to the next-best match (and ultimately to the caller's own
// fallback when nothing usable matches, per the no-match-fallback decision).
export async function resolveRoutedOwner(tx, agencyId, attrs, sourceType) {
  const rules = await tx.leadRoutingRule.findMany({ where: { agencyId, isActive: true }, orderBy: { sortOrder: "asc" } });
  const matches = matchLeadRoutingRules(rules, attrs, sourceType);
  for (const rule of matches) {
    const target = await tx.user.findFirst({
      where: { id: rule.targetUserId, agencyId, status: "active", memberships: { some: { agencyId, isActive: true, role: { in: ["admin", "consultant", "frontdesk"] } } } },
      select: { id: true },
    });
    if (!target) continue;
    await tx.leadRoutingRule.update({ where: { id: rule.id }, data: { lastMatchedAt: new Date(), matchCount: { increment: 1 } } });
    return { ownerUserId: target.id, ruleId: rule.id, ruleName: rule.name };
  }
  return null;
}

function parseConditions(input) {
  if (!Array.isArray(input) || !input.length) throw createHttpError(400, "Add at least one condition.", "VALIDATION_ERROR");
  if (input.length > 10) throw createHttpError(400, "A rule can have at most 10 conditions.", "VALIDATION_ERROR");
  return input.map((item) => {
    const field = String(item?.field || "");
    const value = String(item?.value ?? "").trim();
    if (!ROUTING_RULE_FIELDS.includes(field)) throw createHttpError(400, `${field || "(blank)"} is not a field a rule can match on.`, "VALIDATION_ERROR");
    if (!value) throw createHttpError(400, "Every condition needs a value to match against.", "VALIDATION_ERROR");
    if (value.length > 500) throw createHttpError(400, "A condition value must be 500 characters or fewer.", "VALIDATION_ERROR");
    return { field, value };
  });
}

function parseRoutingRuleInput(body = {}) {
  const name = String(body?.name || "").trim();
  if (!name) throw createHttpError(400, "Name the rule so it's identifiable in the list.", "VALIDATION_ERROR");
  if (name.length > 120) throw createHttpError(400, "The rule name must be 120 characters or fewer.", "VALIDATION_ERROR");
  const targetUserId = String(body?.targetUserId || "");
  if (!targetUserId) throw createHttpError(400, "Select who matching leads should go to.", "VALIDATION_ERROR");
  const conditions = parseConditions(body?.conditions);
  const isActive = typeof body?.isActive === "boolean" ? body.isActive : true;
  const sortOrder = Number.isInteger(body?.sortOrder) ? body.sortOrder : 0;
  return { name, targetUserId, conditions, isActive, sortOrder };
}

export async function listLeadRoutingRules(req, db = prisma) {
  return db.leadRoutingRule.findMany({
    where: { agencyId: req.auth.agencyId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: { targetUser: { select: { id: true, fullName: true, role: true } } },
  });
}

export async function createLeadRoutingRule(req, db = prisma) {
  const values = parseRoutingRuleInput(req.body);
  const agencyId = req.auth.agencyId;
  const actorId = req.auth.userId;
  return db.$transaction(async (tx) => {
    await requireLeadStaff(tx, agencyId, values.targetUserId);
    const existing = await tx.leadRoutingRule.findFirst({ where: { agencyId, name: values.name } });
    if (existing) throw createHttpError(409, "A rule with this name already exists.", "DUPLICATE_ROUTING_RULE");
    return tx.leadRoutingRule.create({
      data: { ...values, agencyId, createdById: actorId, updatedById: actorId },
      include: { targetUser: { select: { id: true, fullName: true, role: true } } },
    });
  });
}

export async function updateLeadRoutingRule(req, db = prisma) {
  const agencyId = req.auth.agencyId;
  const actorId = req.auth.userId;
  return db.$transaction(async (tx) => {
    const existing = await tx.leadRoutingRule.findFirst({ where: { id: req.params.id, agencyId } });
    if (!existing) throw createHttpError(404, "Lead routing rule not found.", "ROUTING_RULE_NOT_FOUND");
    const data = {};
    if (typeof req.body?.isActive === "boolean" && !("name" in (req.body || {}))) {
      // A bare active/inactive toggle from the list view — the common case,
      // kept cheap so it doesn't need to re-validate the whole rule.
      data.isActive = req.body.isActive;
    } else {
      const values = parseRoutingRuleInput({ ...existing, ...req.body });
      if (values.name !== existing.name) {
        const duplicate = await tx.leadRoutingRule.findFirst({ where: { agencyId, name: values.name, id: { not: existing.id } } });
        if (duplicate) throw createHttpError(409, "A rule with this name already exists.", "DUPLICATE_ROUTING_RULE");
      }
      if (values.targetUserId !== existing.targetUserId) await requireLeadStaff(tx, agencyId, values.targetUserId);
      Object.assign(data, values);
    }
    data.updatedById = actorId;
    return tx.leadRoutingRule.update({
      where: { id: existing.id },
      data,
      include: { targetUser: { select: { id: true, fullName: true, role: true } } },
    });
  });
}

export async function deleteLeadRoutingRule(req, db = prisma) {
  const existing = await db.leadRoutingRule.findFirst({ where: { id: req.params.id, agencyId: req.auth.agencyId } });
  if (!existing) throw createHttpError(404, "Lead routing rule not found.", "ROUTING_RULE_NOT_FOUND");
  await db.leadRoutingRule.delete({ where: { id: existing.id } });
  return { id: existing.id };
}
