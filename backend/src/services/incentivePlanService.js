import prisma from "./prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { buildInvoiceIncentiveSnapshotForPlan } from "./incentiveCreditingService.js";
import { logger } from "./logger.js";

export const FORMULA_TYPES = ["FLAT_PER_PAYMENT", "PERCENT_OF_PAYMENT", "TIERED_PERCENT_OF_REVENUE"];
export const ATTRIBUTION_KINDS = ["CASE_ROLE", "LEAD_OWNER", "LEAD_CONVERTER"];

const planInclude = {
  tiers: { orderBy: { minCumulativeAmount: "asc" } },
  roleShares: { include: { caseRole: { select: { id: true, code: true, name: true } } } },
  createdBy: { select: { id: true, fullName: true } },
};

function toDecimalString(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return number;
}

function normalizeCaseType(value) {
  const text = String(value || "").trim();
  return text || null;
}

function validateFormula(values) {
  const formulaType = String(values?.formulaType || "").trim();
  if (!FORMULA_TYPES.includes(formulaType)) throw createHttpError(400, "Choose a valid formula type.", "VALIDATION_ERROR");

  const data = { formulaType, flatAmount: null, percentRate: null };
  let tiers = [];

  if (formulaType === "FLAT_PER_PAYMENT") {
    const amount = toDecimalString(values?.flatAmount);
    if (amount === null || amount <= 0) throw createHttpError(400, "Enter a flat amount greater than zero.", "VALIDATION_ERROR");
    data.flatAmount = amount;
  } else if (formulaType === "PERCENT_OF_PAYMENT") {
    const rate = toDecimalString(values?.percentRate);
    if (rate === null || rate <= 0 || rate > 100) throw createHttpError(400, "Enter a percent rate between 0 and 100.", "VALIDATION_ERROR");
    data.percentRate = rate;
  } else {
    const suppliedTiers = Array.isArray(values?.tiers) ? values.tiers : [];
    if (!suppliedTiers.length) throw createHttpError(400, "Add at least one tier.", "VALIDATION_ERROR");
    tiers = suppliedTiers.map((tier) => {
      const minCumulativeAmount = toDecimalString(tier?.minCumulativeAmount);
      const rate = toDecimalString(tier?.rate);
      if (minCumulativeAmount === null || minCumulativeAmount < 0) throw createHttpError(400, "Each tier needs a valid starting revenue amount.", "VALIDATION_ERROR");
      if (rate === null || rate <= 0 || rate > 100) throw createHttpError(400, "Each tier needs a percent rate between 0 and 100.", "VALIDATION_ERROR");
      return { minCumulativeAmount, rate };
    });
    const seen = new Set();
    for (const tier of tiers) {
      if (seen.has(tier.minCumulativeAmount)) throw createHttpError(400, "Tiers must start at different revenue amounts.", "VALIDATION_ERROR");
      seen.add(tier.minCumulativeAmount);
    }
    tiers.sort((a, b) => a.minCumulativeAmount - b.minCumulativeAmount);
  }
  return { data, tiers };
}

async function validateRoleShares(agencyId, roleShares) {
  const supplied = Array.isArray(roleShares) ? roleShares : [];
  if (!supplied.length) throw createHttpError(400, "Add at least one role share.", "VALIDATION_ERROR");

  const normalized = supplied.map((share) => {
    const attributionKind = String(share?.attributionKind || "").trim();
    if (!ATTRIBUTION_KINDS.includes(attributionKind)) throw createHttpError(400, "Choose a valid attribution kind for each share.", "VALIDATION_ERROR");
    const sharePercent = toDecimalString(share?.sharePercent);
    if (sharePercent === null || sharePercent <= 0 || sharePercent > 100) throw createHttpError(400, "Each share must be a percent between 0 and 100.", "VALIDATION_ERROR");
    const caseRoleId = attributionKind === "CASE_ROLE" ? String(share?.caseRoleId || "").trim() : null;
    if (attributionKind === "CASE_ROLE" && !caseRoleId) throw createHttpError(400, "Choose a case role for each case-role share.", "VALIDATION_ERROR");
    return { attributionKind, caseRoleId, sharePercent };
  });

  const dedupeKeys = new Set();
  for (const share of normalized) {
    const key = `${share.attributionKind}:${share.caseRoleId || ""}`;
    if (dedupeKeys.has(key)) throw createHttpError(400, "Each role can only appear once in a plan's shares.", "VALIDATION_ERROR");
    dedupeKeys.add(key);
  }

  const total = normalized.reduce((sum, share) => sum + share.sharePercent, 0);
  if (Math.abs(total - 100) > 0.01) throw createHttpError(400, `Role shares must sum to exactly 100% (currently ${total.toFixed(2)}%).`, "VALIDATION_ERROR");

  const caseRoleIds = [...new Set(normalized.filter((share) => share.caseRoleId).map((share) => share.caseRoleId))];
  if (caseRoleIds.length) {
    const validRoles = await prisma.agencyCaseRole.findMany({ where: { agencyId, id: { in: caseRoleIds }, isActive: true }, select: { id: true } });
    const validIds = new Set(validRoles.map((role) => role.id));
    if (caseRoleIds.some((id) => !validIds.has(id))) throw createHttpError(400, "One or more selected case roles are invalid.", "VALIDATION_ERROR");
  }

  return normalized;
}

export async function listIncentivePlans(agencyId, { includeInactive = true } = {}) {
  return prisma.incentivePlan.findMany({
    where: { agencyId, ...(includeInactive ? {} : { isActive: true }) },
    include: planInclude,
    orderBy: [{ caseType: "asc" }, { name: "asc" }],
  });
}

export async function getIncentivePlan(agencyId, id) {
  const plan = await prisma.incentivePlan.findFirst({ where: { id, agencyId }, include: planInclude });
  if (!plan) throw createHttpError(404, "Incentive plan not found.", "NOT_FOUND");
  return plan;
}

export async function createIncentivePlan(agencyId, userId, values) {
  const name = String(values?.name || "").trim().slice(0, 100);
  if (!name) throw createHttpError(400, "Enter a name for this plan.", "VALIDATION_ERROR");
  const caseType = normalizeCaseType(values?.caseType);
  const { data: formula, tiers } = validateFormula(values);
  const roleShares = await validateRoleShares(agencyId, values?.roleShares);

  return prisma.incentivePlan.create({
    data: {
      agencyId,
      name,
      caseType,
      ...formula,
      isActive: false,
      createdById: userId,
      tiers: { create: tiers },
      roleShares: { create: roleShares },
    },
    include: planInclude,
  });
}

export async function updateIncentivePlan(agencyId, id, values) {
  const current = await prisma.incentivePlan.findFirst({ where: { id, agencyId } });
  if (!current) throw createHttpError(404, "Incentive plan not found.", "NOT_FOUND");
  if (values?.isActive === true) {
    throw createHttpError(400, "Use the activate action to make a plan active — it needs to atomically replace whatever plan is currently active for this case type.", "VALIDATION_ERROR");
  }

  const data = {};
  if (values?.name !== undefined) {
    data.name = String(values.name || "").trim().slice(0, 100);
    if (!data.name) throw createHttpError(400, "Enter a name for this plan.", "VALIDATION_ERROR");
  }
  if (values?.caseType !== undefined) data.caseType = normalizeCaseType(values.caseType);

  let tiers = null;
  if (values?.formulaType !== undefined) {
    const formula = validateFormula(values);
    Object.assign(data, formula.data);
    tiers = formula.tiers;
  }

  let roleShares = null;
  if (values?.roleShares !== undefined) {
    roleShares = await validateRoleShares(agencyId, values.roleShares);
  }

  if (values?.isActive === false && current.isActive) {
    data.isActive = false;
    data.deactivatedAt = new Date();
  }

  data.version = { increment: 1 };

  return prisma.$transaction(async (tx) => {
    if (tiers !== null) {
      await tx.incentivePlanTier.deleteMany({ where: { planId: id } });
      if (tiers.length) await tx.incentivePlanTier.createMany({ data: tiers.map((tier) => ({ ...tier, planId: id })) });
    }
    if (roleShares !== null) {
      await tx.incentivePlanRoleShare.deleteMany({ where: { planId: id } });
      if (roleShares.length) await tx.incentivePlanRoleShare.createMany({ data: roleShares.map((share) => ({ ...share, planId: id })) });
    }
    await tx.incentivePlan.update({ where: { id }, data });
    return tx.incentivePlan.findUnique({ where: { id }, include: planInclude });
  });
}

// Atomically deactivates whatever plan currently holds this plan's
// (agencyId, caseType) scope and activates this one — the only way a plan
// becomes active, so "exactly one active plan per scope" is a real
// invariant rather than a UI convention. A plan must have at least one
// role share (validated at create/update time already) before it can be
// activated.
export async function activateIncentivePlan(agencyId, id) {
  return prisma.$transaction(async (tx) => {
    const plan = await tx.incentivePlan.findFirst({ where: { id, agencyId }, include: { roleShares: true } });
    if (!plan) throw createHttpError(404, "Incentive plan not found.", "NOT_FOUND");
    if (!plan.roleShares.length) throw createHttpError(409, "Add role shares before activating this plan.", "VALIDATION_ERROR");
    if (plan.isActive) return tx.incentivePlan.findUnique({ where: { id }, include: planInclude });

    const now = new Date();
    await tx.incentivePlan.updateMany({
      where: { agencyId, caseType: plan.caseType, isActive: true, id: { not: id } },
      data: { isActive: false, deactivatedAt: now },
    });
    await tx.incentivePlan.update({ where: { id }, data: { isActive: true, activatedAt: now, deactivatedAt: null } });
    return tx.incentivePlan.findUnique({ where: { id }, include: planInclude });
  });
}

export async function deleteIncentivePlan(agencyId, id) {
  const current = await prisma.incentivePlan.findFirst({ where: { id, agencyId } });
  if (!current) throw createHttpError(404, "Incentive plan not found.", "NOT_FOUND");
  try {
    await prisma.incentivePlan.delete({ where: { id } });
  } catch (error) {
    // IncentiveLedgerEntry.incentivePlanId is onDelete: Restrict once that
    // model exists (M3) — a plan with real payout history can't be deleted.
    if (error?.code === "P2003") throw createHttpError(409, "This plan has incentive history and can't be deleted. Deactivate it instead.", "PLAN_IN_USE");
    throw error;
  }
}

function legacyInvoiceWhere(agencyId, plan) {
  return {
    agencyId,
    balance: { gt: 0 },
    status: { notIn: ["Void", "Voided"] },
    ...(plan.caseType ? { case: { caseType: plan.caseType, deletedAt: null } } : { case: { deletedAt: null } }),
    incentiveLedgerEntries: { none: {} },
    OR: [
      { incentiveSnapshot: null },
      { incentiveSnapshot: { is: { incentivePlanId: null } } },
    ],
  };
}

async function requireActivePlan(agencyId, id) {
  const plan = await prisma.incentivePlan.findFirst({ where: { id, agencyId } });
  if (!plan) throw createHttpError(404, "Incentive plan not found.", "NOT_FOUND");
  if (!plan.isActive) throw createHttpError(409, "Activate this plan before applying it to old invoices.", "PLAN_NOT_ACTIVE");
  return plan;
}

export async function previewLegacyInvoicePlanApplication(agencyId, id) {
  const plan = await requireActivePlan(agencyId, id);
  const where = legacyInvoiceWhere(agencyId, plan);
  const [count, totals, invoices] = await Promise.all([
    prisma.caseInvoice.count({ where }),
    prisma.caseInvoice.aggregate({ where, _sum: { balance: true } }),
    prisma.caseInvoice.findMany({
      where,
      take: 25,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true, balance: true, amount: true, description: true, createdAt: true,
        case: { select: { id: true, caseType: true, client: { select: { id: true, fullName: true } } } },
      },
    }),
  ]);
  return { plan: { id: plan.id, name: plan.name, caseType: plan.caseType }, count, outstandingTotal: Number(totals._sum.balance || 0), invoices };
}

export async function applyPlanToLegacyInvoices(agencyId, id, actorUserId) {
  const plan = await requireActivePlan(agencyId, id);
  const candidates = await prisma.caseInvoice.findMany({
    where: legacyInvoiceWhere(agencyId, plan),
    select: { id: true, caseId: true, clientId: true, balance: true },
  });
  let applied = 0;
  let skipped = 0;
  let skippedNoRecipients = 0;
  for (const invoice of candidates) {
    const snapshot = await buildInvoiceIncentiveSnapshotForPlan(agencyId, invoice.caseId, plan.id);
    if (!snapshot) throw createHttpError(409, "This plan is no longer active.", "PLAN_NOT_ACTIVE");
    const hasRecipient = snapshot.recipients.some((share) => Array.isArray(share.userIds) && share.userIds.length > 0);
    if (!hasRecipient) {
      skippedNoRecipients += 1;
      continue;
    }
    const changed = await prisma.$transaction(async (tx) => {
      const current = await tx.caseInvoice.findFirst({
        where: { id: invoice.id, ...legacyInvoiceWhere(agencyId, plan) },
        select: { id: true, incentiveSnapshot: { select: { id: true } } },
      });
      if (!current) return false;
      if (current.incentiveSnapshot) {
        await tx.caseInvoiceIncentiveSnapshot.update({ where: { id: current.incentiveSnapshot.id }, data: snapshot });
      } else {
        await tx.caseInvoiceIncentiveSnapshot.create({ data: { ...snapshot, caseInvoiceId: invoice.id } });
      }
      return true;
    });
    if (!changed) {
      skipped += 1;
      continue;
    }
    applied += 1;
    await recordActivity({
      agencyId, userId: actorUserId, clientId: invoice.clientId, caseId: invoice.caseId,
      action: "incentive.legacy_invoice_plan_applied",
      details: `${plan.name} applied to an existing invoice with $${Number(invoice.balance).toFixed(2)} outstanding; only future collections qualify`,
      entityType: "caseInvoice", entityId: invoice.id,
      metadata: { incentivePlanId: plan.id, outstandingBalance: Number(invoice.balance) },
    }).catch((error) => logger.warn("incentive.legacy_invoice_activity_failed", { agencyId, caseInvoiceId: invoice.id, reason: error.message }));
  }
  return { applied, skipped, skippedNoRecipients };
}
