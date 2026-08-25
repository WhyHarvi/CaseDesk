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
import { moveLeadOwnership, requireLeadStaff } from "./lead.service.js";

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
  // A structured interest selected by the lead is more authoritative than
  // generic words in a website transcript. When a rule offers both fields as
  // alternatives, use initialMessage only as a fallback for older/unstructured
  // leads whose immigrationInterest is blank. This prevents a PR enquiry from
  // matching "study" merely because its questionnaire asks about Canadian
  // study or work experience.
  const hasStructuredInterest = String(context.immigrationInterest || "").trim().length > 0;
  const hasInterestCondition = conditions.some((condition) => condition.field === "immigrationInterest");
  const effectiveConditions = rule.matchMode !== "ALL" && hasStructuredInterest && hasInterestCondition
    ? conditions.filter((condition) => condition.field !== "initialMessage")
    : conditions;
  const matches = effectiveConditions.map((condition) => conditionMatches(condition, context));
  return rule.matchMode === "ALL" ? matches.every(Boolean) : matches.some(Boolean);
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
    if (!rule.targetUserId) continue;
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
  const targetUserId = String(body?.targetUserId || "") || null;
  const conditions = parseConditions(body?.conditions);
  const isActive = typeof body?.isActive === "boolean" ? body.isActive : true;
  if (isActive && !targetUserId) throw createHttpError(400, "Select a team member before activating this rule.", "VALIDATION_ERROR");
  const sortOrder = Number.isInteger(body?.sortOrder) ? body.sortOrder : 0;
  const matchMode = String(body?.matchMode || "ANY").toUpperCase();
  if (!['ANY', 'ALL'].includes(matchMode)) throw createHttpError(400, "Condition matching must use any or all conditions.", "VALIDATION_ERROR");
  return { name, targetUserId, conditions, matchMode, isActive, sortOrder };
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
    if (values.targetUserId) await requireLeadStaff(tx, agencyId, values.targetUserId);
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
      if (req.body.isActive && !existing.targetUserId) throw createHttpError(400, "Assign a team member before activating this rule.", "VALIDATION_ERROR");
      data.isActive = req.body.isActive;
    } else {
      const values = parseRoutingRuleInput({ ...existing, ...req.body });
      if (values.name !== existing.name) {
        const duplicate = await tx.leadRoutingRule.findFirst({ where: { agencyId, name: values.name, id: { not: existing.id } } });
        if (duplicate) throw createHttpError(409, "A rule with this name already exists.", "DUPLICATE_ROUTING_RULE");
      }
      if (values.targetUserId && values.targetUserId !== existing.targetUserId) await requireLeadStaff(tx, agencyId, values.targetUserId);
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

const backlogLeadSelect = {
  id: true,
  leadNumber: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  province: true,
  preferredLanguage: true,
  priority: true,
  immigrationInterest: true,
  initialMessage: true,
  status: true,
  stage: true,
  inquiryDate: true,
  createdAt: true,
  ownerUserId: true,
  nextActionOwnerId: true,
  owner: { select: { id: true, fullName: true } },
  originalSource: { select: { id: true, name: true, type: true } },
};

async function requireBacklogRule(db, agencyId, ruleId) {
  const rule = await db.leadRoutingRule.findFirst({
    where: { id: ruleId, agencyId },
    include: { targetUser: { select: { id: true, fullName: true, role: true, status: true } } },
  });
  if (!rule) throw createHttpError(404, "Lead routing rule not found.", "ROUTING_RULE_NOT_FOUND");
  return rule;
}

export async function listLeadRoutingBacklog(req, db = prisma) {
  const agencyId = req.auth.agencyId;
  const rule = await requireBacklogRule(db, agencyId, req.params.id);
  const [leads, reviews] = await Promise.all([
    db.lead.findMany({
      where: { agencyId, deletedAt: null },
      select: backlogLeadSelect,
      orderBy: [{ inquiryDate: "desc" }, { createdAt: "desc" }],
      take: 1000,
    }),
    db.leadRoutingBacklogReview.findMany({
      where: { agencyId, ruleId: rule.id },
      select: { leadId: true, decision: true },
    }),
  ]);
  const reviewedIds = new Set(reviews.map((item) => item.leadId));
  const matches = leads.filter((lead) => matchLeadRoutingRules([rule], lead, lead.originalSource?.type).length > 0);
  const alreadyAssigned = matches.filter((lead) => lead.ownerUserId === rule.targetUserId);
  const actionable = matches.filter((lead) => lead.ownerUserId !== rule.targetUserId);
  return {
    rule,
    candidates: actionable.filter((lead) => !reviewedIds.has(lead.id)),
    totals: {
      matched: matches.length,
      pending: actionable.filter((lead) => !reviewedIds.has(lead.id)).length,
      assigned: reviews.filter((item) => item.decision === "ASSIGNED").length,
      skipped: reviews.filter((item) => item.decision === "SKIPPED").length,
      alreadyAssigned: alreadyAssigned.length,
    },
    capped: leads.length === 1000,
  };
}

export async function reviewLeadRoutingBacklog(req, db = prisma) {
  const decision = String(req.body?.decision || "").toUpperCase();
  if (!['ASSIGNED', 'SKIPPED'].includes(decision)) throw createHttpError(400, "Choose assign or skip.", "VALIDATION_ERROR");
  const agencyId = req.auth.agencyId;
  const actorId = req.auth.userId;
  try {
    return await db.$transaction(async (tx) => {
      const rule = await requireBacklogRule(tx, agencyId, req.params.id);
      const lead = await tx.lead.findFirst({ where: { id: req.params.leadId, agencyId, deletedAt: null }, select: backlogLeadSelect });
      if (!lead || !matchLeadRoutingRules([rule], lead, lead.originalSource?.type).length) {
        throw createHttpError(404, "This lead is not in the rule's backlog.", "ROUTING_BACKLOG_LEAD_NOT_FOUND");
      }
      if (lead.ownerUserId === rule.targetUserId) throw createHttpError(409, "This lead is already assigned to the rule's target.", "ROUTING_BACKLOG_ALREADY_ASSIGNED");
      const existing = await tx.leadRoutingBacklogReview.findFirst({ where: { ruleId: rule.id, leadId: lead.id } });
      if (existing) throw createHttpError(409, "This backlog match has already been reviewed.", "ROUTING_BACKLOG_ALREADY_REVIEWED");
      let updatedLead = lead;
      if (decision === "ASSIGNED" && lead.ownerUserId !== rule.targetUserId) {
        await requireLeadStaff(tx, agencyId, rule.targetUserId);
        updatedLead = await moveLeadOwnership(tx, {
          agencyId,
          lead,
          ownerUserId: rule.targetUserId,
          actorId,
          assignmentType: "RULE_BASED",
          reason: `Backlog review: assigned by rule "${rule.name}"`,
        });
        await tx.leadRoutingRule.update({ where: { id: rule.id }, data: { lastMatchedAt: new Date(), matchCount: { increment: 1 } } });
      }
      const review = await tx.leadRoutingBacklogReview.create({
        data: { agencyId, ruleId: rule.id, leadId: lead.id, decision, previousOwnerId: lead.ownerUserId, targetUserId: rule.targetUserId, reviewedById: actorId },
      });
      await tx.activityLog.create({
        data: { agencyId, userId: actorId, action: `lead.routing_backlog_${decision.toLowerCase()}`, details: `${lead.leadNumber}: ${decision === "ASSIGNED" ? `assigned using ${rule.name}` : `skipped ${rule.name}`}`, entityType: "leadRoutingBacklogReview", entityId: review.id, metadata: { leadId: lead.id, ruleId: rule.id, previousOwnerId: lead.ownerUserId, targetUserId: rule.targetUserId } },
      });
      return { review, lead: updatedLead };
    });
  } catch (error) {
    if (error?.code === "P2002") throw createHttpError(409, "This backlog match has already been reviewed.", "ROUTING_BACKLOG_ALREADY_REVIEWED");
    throw error;
  }
}
