import prisma from "./prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { buildInvoiceIncentiveSnapshotForPlan, computePool, computeSplits, resolveHolders, tierRateFor } from "./incentiveCreditingService.js";
import { CHECKPOINT_TYPES, CHECKPOINT_TYPES_REQUIRING_VALUE } from "./incentiveTimelineCheckpoints.js";
import { CASE_STAGES, isCaseStageAllowedForType } from "../constants/caseStages.js";
import { LEAD_STAGES } from "../modules/leads/lead.constants.js";
import { logger } from "./logger.js";

export const FORMULA_TYPES = ["FLAT_PER_PAYMENT", "PERCENT_OF_PAYMENT", "TIERED_PERCENT_OF_REVENUE"];
export const ATTRIBUTION_KINDS = ["CASE_ROLE", "LEAD_OWNER", "LEAD_CONVERTER", "PAYMENT_PROCESSOR"];
export const MILESTONE_EVENT_TYPES = [
  "COLLEGE_APPLICATION_SUBMITTED",
  "STUDY_PERMIT_APPLICATION_SUBMITTED",
  "POST_SUBMISSION_FOLLOW_UP_COMPLETED",
];

const planInclude = {
  tiers: { orderBy: { minCumulativeAmount: "asc" } },
  roleShares: { include: { caseRole: { select: { id: true, code: true, name: true } } } },
  timelineLegs: { orderBy: { sortOrder: "asc" }, include: { tiers: { orderBy: { thresholdDays: "asc" } } } },
  milestoneRules: { orderBy: { sortOrder: "asc" } },
  createdBy: { select: { id: true, fullName: true } },
};

function validateMilestoneRules(caseType, values) {
  const supplied = Array.isArray(values) ? values : [];
  if (!supplied.length) return [];
  if (!/study permit/i.test(String(caseType || ""))) {
    throw createHttpError(400, "Study Permit milestone rewards require a Study Permit case type.", "VALIDATION_ERROR");
  }
  const seen = new Set();
  return supplied.map((rule, index) => {
    const eventType = String(rule?.eventType || "").trim();
    const name = String(rule?.name || "").trim().slice(0, 120);
    const flatAmount = toDecimalString(rule?.flatAmount);
    const payoutPercent = toDecimalString(rule?.payoutPercent);
    if (!MILESTONE_EVENT_TYPES.includes(eventType) || seen.has(eventType)) {
      throw createHttpError(400, "Choose each Study Permit milestone at most once.", "VALIDATION_ERROR");
    }
    if (!name || flatAmount === null || flatAmount <= 0 || payoutPercent === null || payoutPercent <= 0 || payoutPercent > 100) {
      throw createHttpError(400, "Each milestone needs a source amount and consultant percentage between 0 and 100.", "VALIDATION_ERROR");
    }
    seen.add(eventType);
    return { agencyId: null, eventType, name, flatAmount, payoutPercent, sortOrder: index, isActive: rule?.isActive !== false };
  });
}

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
    const validRoles = await prisma.agencyCaseRole.findMany({ where: { agencyId, id: { in: caseRoleIds }, isActive: true }, select: { id: true, code: true } });
    const validIds = new Set(validRoles.map((role) => role.id));
    if (caseRoleIds.some((id) => !validIds.has(id))) throw createHttpError(400, "One or more selected case roles are invalid.", "VALIDATION_ERROR");
    if (validRoles.some((role) => role.code === "frontdesk")) {
      throw createHttpError(400, "Frontdesk incentives must use Payment processor so credit follows the person who recorded each payment.", "EVENT_ATTRIBUTION_REQUIRED");
    }
  }

  return normalized;
}

function validateCheckpoint(type, value, caseType, label) {
  const checkpointType = String(type || "").trim();
  if (!CHECKPOINT_TYPES.includes(checkpointType)) throw createHttpError(400, `Choose a valid ${label} checkpoint.`, "VALIDATION_ERROR");

  const requiresValue = CHECKPOINT_TYPES_REQUIRING_VALUE.has(checkpointType);
  const checkpointValue = requiresValue ? String(value || "").trim() : null;
  if (requiresValue && !checkpointValue) throw createHttpError(400, `Choose a stage for the ${label} checkpoint.`, "VALIDATION_ERROR");
  if (!requiresValue && value) throw createHttpError(400, `The ${label} checkpoint doesn't take a stage.`, "VALIDATION_ERROR");

  if (checkpointType === "LEAD_STAGE_REACHED" && !LEAD_STAGES.includes(checkpointValue)) {
    throw createHttpError(400, `"${checkpointValue}" isn't a valid lead stage.`, "VALIDATION_ERROR");
  }
  if (checkpointType === "CASE_STAGE_REACHED") {
    if (!CASE_STAGES.includes(checkpointValue)) throw createHttpError(400, `"${checkpointValue}" isn't a valid case stage.`, "VALIDATION_ERROR");
    if (caseType && !isCaseStageAllowedForType(caseType, checkpointValue)) {
      throw createHttpError(400, `"${checkpointValue}" isn't a valid stage for this plan's case type.`, "VALIDATION_ERROR");
    }
  }
  return { checkpointType, checkpointValue };
}

// Timeline legs are optional — a plan with none behaves exactly as it did
// before this feature existed. Unlike tiers/roleShares this needs no DB
// lookup (checkpoint vocabularies are static lists), so it stays sync.
export function validateTimelineLegs(caseType, timelineLegs) {
  const supplied = Array.isArray(timelineLegs) ? timelineLegs : [];
  if (!supplied.length) return [];

  const seenLegKeys = new Set();
  return supplied.map((leg) => {
    const name = String(leg?.name || "").trim().slice(0, 100);
    if (!name) throw createHttpError(400, "Enter a name for each timeline leg.", "VALIDATION_ERROR");

    const from = validateCheckpoint(leg?.fromCheckpointType, leg?.fromCheckpointValue, caseType, "starting");
    const to = validateCheckpoint(leg?.toCheckpointType, leg?.toCheckpointValue, caseType, "ending");
    if (from.checkpointType === to.checkpointType && from.checkpointValue === to.checkpointValue) {
      throw createHttpError(400, `"${name}" needs different starting and ending checkpoints.`, "VALIDATION_ERROR");
    }
    const legKey = `${from.checkpointType}:${from.checkpointValue || ""}>${to.checkpointType}:${to.checkpointValue || ""}`;
    if (seenLegKeys.has(legKey)) throw createHttpError(400, "Two timeline legs can't share the exact same start and end checkpoints.", "VALIDATION_ERROR");
    seenLegKeys.add(legKey);

    const baseBonusAmount = toDecimalString(leg?.baseBonusAmount);
    if (baseBonusAmount === null || baseBonusAmount <= 0) throw createHttpError(400, `Enter a base bonus amount greater than zero for "${name}".`, "VALIDATION_ERROR");

    const suppliedTiers = Array.isArray(leg?.tiers) ? leg.tiers : [];
    if (!suppliedTiers.length) throw createHttpError(400, `Add at least one tier for "${name}".`, "VALIDATION_ERROR");
    const tiers = suppliedTiers.map((tier) => {
      const thresholdDays = toDecimalString(tier?.thresholdDays);
      const multiplierPercent = toDecimalString(tier?.multiplierPercent);
      if (thresholdDays === null || thresholdDays <= 0) throw createHttpError(400, `Each tier in "${name}" needs a number of days greater than zero.`, "VALIDATION_ERROR");
      if (multiplierPercent === null || multiplierPercent <= 0 || multiplierPercent > 100) throw createHttpError(400, `Each tier in "${name}" needs a bonus multiplier between 0 and 100.`, "VALIDATION_ERROR");
      return { thresholdDays, multiplierPercent };
    });
    const seenThresholds = new Set();
    for (const tier of tiers) {
      if (seenThresholds.has(tier.thresholdDays)) throw createHttpError(400, `Tiers in "${name}" must use different day thresholds.`, "VALIDATION_ERROR");
      seenThresholds.add(tier.thresholdDays);
    }
    tiers.sort((a, b) => a.thresholdDays - b.thresholdDays);

    return {
      name,
      fromCheckpointType: from.checkpointType,
      fromCheckpointValue: from.checkpointValue,
      toCheckpointType: to.checkpointType,
      toCheckpointValue: to.checkpointValue,
      baseBonusAmount,
      tiers,
    };
  });
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
  const timelineLegs = validateTimelineLegs(caseType, values?.timelineLegs);
  const milestoneRules = validateMilestoneRules(caseType, values?.milestoneRules);

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
      timelineLegs: {
        create: timelineLegs.map((leg, index) => ({ ...leg, sortOrder: index, tiers: { create: leg.tiers } })),
      },
      milestoneRules: { create: milestoneRules.map(({ agencyId: _ignored, ...rule }) => ({ ...rule, agencyId })) },
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

  let timelineLegs = null;
  if (values?.timelineLegs !== undefined) {
    const effectiveCaseType = data.caseType !== undefined ? data.caseType : current.caseType;
    timelineLegs = validateTimelineLegs(effectiveCaseType, values.timelineLegs);
  }

  let milestoneRules = null;
  if (values?.milestoneRules !== undefined) {
    const effectiveCaseType = data.caseType !== undefined ? data.caseType : current.caseType;
    milestoneRules = validateMilestoneRules(effectiveCaseType, values.milestoneRules);
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
    if (timelineLegs !== null) {
      // Deleted and recreated whole, same as tiers/roleShares above — a
      // nested createMany can't also create each leg's tiers in one call,
      // so this loops one create() per leg instead.
      await tx.incentivePlanTimelineLeg.deleteMany({ where: { planId: id } });
      for (const [index, leg] of timelineLegs.entries()) {
        await tx.incentivePlanTimelineLeg.create({ data: { ...leg, planId: id, sortOrder: index, tiers: { create: leg.tiers } } });
      }
    }
    if (milestoneRules !== null) {
      await tx.incentivePlanMilestoneRule.deleteMany({ where: { planId: id } });
      if (milestoneRules.length) {
        await tx.incentivePlanMilestoneRule.createMany({
          data: milestoneRules.map(({ agencyId: _ignored, ...rule }) => ({ ...rule, agencyId, planId: id })),
        });
      }
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
    const plan = await tx.incentivePlan.findFirst({ where: { id, agencyId }, include: { roleShares: { include: { caseRole: { select: { code: true } } } } } });
    if (!plan) throw createHttpError(404, "Incentive plan not found.", "NOT_FOUND");
    if (!plan.roleShares.length) throw createHttpError(409, "Add role shares before activating this plan.", "VALIDATION_ERROR");
    if (plan.roleShares.some((share) => share.attributionKind === "CASE_ROLE" && share.caseRole?.code === "frontdesk")) {
      throw createHttpError(409, "Replace the Frontdesk case-role share with Payment processor before activating this plan.", "EVENT_ATTRIBUTION_REQUIRED");
    }
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

export async function deactivateIncentivePlan(agencyId, id) {
  const plan = await prisma.incentivePlan.findFirst({ where: { id, agencyId } });
  if (!plan) throw createHttpError(404, "Incentive plan not found.", "NOT_FOUND");
  if (!plan.isActive) return getIncentivePlan(agencyId, id);
  return prisma.incentivePlan.update({
    where: { id },
    data: { isActive: false, deactivatedAt: new Date() },
    include: planInclude,
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
  const plan = await prisma.incentivePlan.findFirst({ where: { id, agencyId }, include: { tiers: { orderBy: { minCumulativeAmount: "asc" } }, roleShares: true } });
  if (!plan) throw createHttpError(404, "Incentive plan not found.", "NOT_FOUND");
  if (!plan.isActive) throw createHttpError(409, "Activate this plan before applying it to old invoices.", "PLAN_NOT_ACTIVE");
  return plan;
}

function paidAmountForHistoricalInvoice(invoice) {
  const refunded = (invoice.refunds || []).reduce((sum, refund) => sum + Number(refund.amount || 0), 0);
  return Math.max(0, Number(invoice.amount) - Number(invoice.balance) - refunded);
}

function historicalApprovalTriggerRef(invoiceId, planId) {
  return `retroactive:${invoiceId}:${planId}`;
}

async function findHistoricalApprovalCandidates(agencyId, plan) {
  if (!plan.activatedAt) return [];
  const invoices = await prisma.caseInvoice.findMany({
    where: {
      agencyId,
      lastPaymentAt: { lt: plan.activatedAt },
      status: { notIn: ["Void", "Voided"] },
      ...(plan.caseType ? { case: { caseType: plan.caseType, deletedAt: null } } : { case: { deletedAt: null } }),
      OR: [
        { incentiveSnapshot: null },
        { incentiveSnapshot: { is: { incentivePlanId: null } } },
      ],
      incentiveLedgerEntries: { none: {} },
    },
    orderBy: [{ lastPaymentAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      caseId: true,
      clientId: true,
      invoiceNumber: true,
      description: true,
      amount: true,
      balance: true,
      status: true,
      createdAt: true,
      lastPaymentAt: true,
      refunds: { where: { status: "Completed" }, select: { amount: true } },
      case: { select: { caseType: true, client: { select: { id: true, fullName: true } } } },
    },
  });
  return invoices.filter((invoice) => paidAmountForHistoricalInvoice(invoice) > 0);
}

async function computeHistoricalPool(plan, agencyId, invoice, paidAmount) {
  if (plan.formulaType !== "TIERED_PERCENT_OF_REVENUE") {
    return computePool(plan, { agencyId, caseId: invoice.caseId, delta: paidAmount });
  }
  const priorInvoices = await prisma.caseInvoice.findMany({
    where: {
      agencyId,
      caseId: invoice.caseId,
      lastPaymentAt: { lte: invoice.lastPaymentAt },
      status: { notIn: ["Void", "Voided"] },
    },
    select: {
      amount: true,
      balance: true,
      refunds: { where: { status: "Completed" }, select: { amount: true } },
    },
  });
  const cumulativeAfterPayment = priorInvoices.reduce((sum, row) => sum + paidAmountForHistoricalInvoice(row), 0);
  const rate = tierRateFor(plan.tiers, cumulativeAfterPayment);
  return rate === null ? 0 : (paidAmount * rate) / 100;
}

export async function previewRetroactiveIncentiveApprovals(agencyId, id) {
  const plan = await requireActivePlan(agencyId, id);
  const candidates = await findHistoricalApprovalCandidates(agencyId, plan);
  const rows = [];
  const userIds = new Set();
  for (const invoice of candidates) {
    const snapshot = await buildInvoiceIncentiveSnapshotForPlan(agencyId, invoice.caseId, plan.id);
    if (!snapshot) continue;
    const paidAmount = paidAmountForHistoricalInvoice(invoice);
    const pool = await computeHistoricalPool(plan, agencyId, invoice, paidAmount);
    const entries = computeSplits(plan, pool, await resolveHolders(agencyId, invoice.caseId));
    const eligibleEntries = entries.filter((entry) => entry.amount > 0);
    eligibleEntries.forEach((entry) => userIds.add(entry.userId));
    rows.push({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      description: invoice.description,
      caseId: invoice.caseId,
      caseType: invoice.case.caseType,
      client: invoice.case.client,
      paidAmount,
      paidAt: invoice.lastPaymentAt,
      pool,
      entries: eligibleEntries,
    });
  }
  const users = userIds.size
    ? await prisma.user.findMany({ where: { id: { in: [...userIds] }, agencyId }, select: { id: true, fullName: true } })
    : [];
  const names = new Map(users.map((user) => [user.id, user.fullName]));
  return {
    plan: { id: plan.id, name: plan.name, activatedAt: plan.activatedAt },
    count: rows.length,
    paidTotal: rows.reduce((sum, row) => sum + row.paidAmount, 0),
    incentiveTotal: rows.reduce((sum, row) => sum + row.entries.reduce((entrySum, entry) => entrySum + entry.amount, 0), 0),
    invoices: rows.map((row) => ({ ...row, entries: row.entries.map((entry) => ({ ...entry, userName: names.get(entry.userId) || "Former team member" })) })),
  };
}

export async function approveRetroactiveIncentiveApprovals(agencyId, id, actorUserId) {
  const plan = await requireActivePlan(agencyId, id);
  const candidates = await findHistoricalApprovalCandidates(agencyId, plan);
  let approved = 0;
  let skipped = 0;
  let skippedNoRecipients = 0;
  let creditedTotal = 0;

  for (const invoice of candidates) {
    const paidAmount = paidAmountForHistoricalInvoice(invoice);
    const snapshot = await buildInvoiceIncentiveSnapshotForPlan(agencyId, invoice.caseId, plan.id);
    if (!snapshot) {
      skipped += 1;
      continue;
    }
    const holders = await resolveHolders(agencyId, invoice.caseId);
    const pool = await computeHistoricalPool(plan, agencyId, invoice, paidAmount);
    const entries = computeSplits(plan, pool, holders);
    if (!entries.length) {
      skippedNoRecipients += 1;
      continue;
    }
    const triggerRef = historicalApprovalTriggerRef(invoice.id, plan.id);
    const changed = await prisma.$transaction(async (tx) => {
      const existing = await tx.incentiveLedgerEntry.findFirst({ where: { agencyId, caseInvoiceId: invoice.id, triggerSource: "RETROACTIVE_APPROVAL", triggerRef }, select: { id: true } });
      if (existing) return false;
      await tx.caseInvoiceIncentiveSnapshot.upsert({
        where: { caseInvoiceId: invoice.id },
        create: { ...snapshot, caseInvoiceId: invoice.id },
        update: snapshot,
      });
      // The retroactive rows cover all money collected through the current
      // balance. Advance the normal CAS cursor in the same transaction so
      // the retry worker cannot credit that historical collection again.
      await tx.caseInvoiceCreditCursor.upsert({
        where: { caseInvoiceId: invoice.id },
        create: { agencyId, caseInvoiceId: invoice.id, lastCreditedBalance: Number(invoice.balance) },
        update: { lastCreditedBalance: Number(invoice.balance) },
      });
      await tx.incentiveLedgerEntry.createMany({
        data: entries.map((entry) => ({
          agencyId,
          caseId: invoice.caseId,
          caseInvoiceId: invoice.id,
          incentivePlanId: plan.id,
          userId: entry.userId,
          attributionKind: entry.attributionKind,
          caseRoleId: entry.caseRoleId,
          roleNameSnapshot: entry.roleNameSnapshot,
          sharePercentApplied: entry.sharePercentApplied,
          sourceAmountCollected: paidAmount,
          creditedAmount: entry.amount,
          triggerSource: "RETROACTIVE_APPROVAL",
          triggerRef,
          entryType: "CREDIT",
          creditedAt: invoice.lastPaymentAt || new Date(),
        })),
      });
      return true;
    });
    if (!changed) {
      skipped += 1;
      continue;
    }
    approved += 1;
    creditedTotal += entries.reduce((sum, entry) => sum + entry.amount, 0);
    await recordActivity({
      agencyId,
      userId: actorUserId,
      clientId: invoice.clientId,
      caseId: invoice.caseId,
      action: "incentive.retroactive_approval",
      details: `${plan.name} approved for ${invoice.invoiceNumber}: $${paidAmount.toFixed(2)} collected before plan activation; $${entries.reduce((sum, entry) => sum + entry.amount, 0).toFixed(2)} credited across eligible roles`,
      entityType: "caseInvoice",
      entityId: invoice.id,
      metadata: { incentivePlanId: plan.id, invoiceId: invoice.id, paidAmount, creditedTotal: entries.reduce((sum, entry) => sum + entry.amount, 0), triggerRef },
    });
  }
  return { approved, skipped, skippedNoRecipients, creditedTotal };
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
