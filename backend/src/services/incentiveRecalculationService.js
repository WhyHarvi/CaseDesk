import prisma from "./prisma/client.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { buildInvoiceIncentiveSnapshotForPlan, computeSplits, resolveHolders, tierRateFor } from "./incentiveCreditingService.js";
import { tierMultiplierFor } from "./incentiveTimelineService.js";

export const PLAN_RECALCULATION_TRIGGER = "PLAN_RECALCULATION";
const CREDIT_ENTRY_TYPES = new Set(["CREDIT"]);

const planInclude = {
  tiers: { orderBy: { minCumulativeAmount: "asc" } },
  roleShares: { include: { caseRole: { select: { id: true, name: true } } } },
  timelineLegs: { orderBy: { sortOrder: "asc" }, include: { tiers: { orderBy: { thresholdDays: "asc" } } } },
};

function number(value) {
  return Number(value || 0);
}

function entryKey(entry) {
  return `${entry.userId}|${entry.attributionKind}|${entry.caseRoleId || ""}`;
}

function paymentGroupKey(entry) {
  return `${entry.caseInvoiceId}|${new Date(entry.creditedAt).toISOString()}|${number(entry.sourceAmountCollected).toFixed(2)}`;
}

function timelineGroupKey(evaluation) {
  return `timeline:${evaluation.id}`;
}

function correctionRef(plan, groupKey, key) {
  return `${PLAN_RECALCULATION_TRIGGER.toLowerCase()}:${plan.id}:v${plan.version}:${groupKey}:${key}`;
}

function reversalTotal(entry) {
  return (entry.reversalEntries || []).reduce((sum, row) => sum + number(row.creditedAmount), 0);
}

function liveBucketFor(holders, share) {
  if (share.attributionKind === "LEAD_OWNER") {
    return holders.leadOwnerUserId ? { name: "Lead owner", userIds: [holders.leadOwnerUserId] } : null;
  }
  if (share.attributionKind === "LEAD_CONVERTER") {
    return holders.leadConverterUserId ? { name: "Lead converter", userIds: [holders.leadConverterUserId] } : null;
  }
  return holders.caseRoleHolders.get(share.caseRoleId) || null;
}

// Keep the people attached to an historical attribution point whenever they
// exist, while allowing a newly added role share to use the case's current
// eligible holder. This preserves historical ownership evidence without
// making a changed plan permanently unable to add a newly configured share.
function holdersForHistoricalGroup(plan, groupEntries, liveHolders) {
  const result = {
    leadOwnerUserId: liveHolders.leadOwnerUserId,
    leadConverterUserId: liveHolders.leadConverterUserId,
    paymentProcessorUserId: liveHolders.paymentProcessorUserId || null,
    caseRoleHolders: new Map(liveHolders.caseRoleHolders),
  };
  for (const share of plan.roleShares) {
    const prior = groupEntries.filter((entry) => entry.attributionKind === share.attributionKind && (share.attributionKind !== "CASE_ROLE" || entry.caseRoleId === share.caseRoleId));
    const priorUserIds = [...new Set(prior.map((entry) => entry.userId))];
    if (!priorUserIds.length) continue;
    if (share.attributionKind === "LEAD_OWNER") result.leadOwnerUserId = priorUserIds[0];
    else if (share.attributionKind === "LEAD_CONVERTER") result.leadConverterUserId = priorUserIds[0];
    else if (share.attributionKind === "PAYMENT_PROCESSOR") result.paymentProcessorUserId = priorUserIds[0];
    else {
      const current = liveHolders.caseRoleHolders.get(share.caseRoleId);
      result.caseRoleHolders.set(share.caseRoleId, { name: current?.name || share.caseRole?.name || prior[0]?.roleNameSnapshot || "Case role", userIds: priorUserIds });
    }
  }
  return result;
}

function netByKey(entries) {
  const map = new Map();
  for (const entry of entries) {
    const key = entryKey(entry);
    map.set(key, (map.get(key) || 0) + number(entry.creditedAmount) + reversalTotal(entry));
  }
  return map;
}

function originalCreditByKey(entries) {
  const map = new Map();
  for (const entry of entries) {
    const key = entryKey(entry);
    const bucket = map.get(key) || { creditedAmount: 0, reversalAmount: 0, entry };
    bucket.creditedAmount += number(entry.creditedAmount);
    bucket.reversalAmount += reversalTotal(entry);
    map.set(key, bucket);
  }
  return map;
}

function targetNetByKey(targetEntries, originalEntries) {
  const original = originalCreditByKey(originalEntries);
  const targetCredits = new Map();
  for (const entry of targetEntries) targetCredits.set(entryKey(entry), (targetCredits.get(entryKey(entry)) || 0) + number(entry.amount));
  const keys = new Set([...original.keys(), ...targetCredits.keys()]);
  const result = new Map();
  for (const key of keys) {
    const old = original.get(key);
    const targetCredit = targetCredits.get(key) || 0;
    const refundRatio = old?.creditedAmount > 0
      ? Math.min(1, Math.max(0, Math.abs(old.reversalAmount) / old.creditedAmount))
      : 0;
    result.set(key, targetCredit * (1 - refundRatio));
  }
  return result;
}

function correctionRows({ plan, groupKey, originalEntries, targetEntries, creditedAt, caseId, caseInvoiceId, timelineLegEvaluationId = null }) {
  const current = netByKey(originalEntries);
  const target = targetNetByKey(targetEntries, originalEntries);
  const targetByKey = new Map(targetEntries.map((entry) => [entryKey(entry), entry]));
  const originalByKey = new Map(originalEntries.map((entry) => [entryKey(entry), entry]));
  const rows = [];
  for (const key of new Set([...current.keys(), ...target.keys()])) {
    const delta = Math.round(((target.get(key) || 0) - (current.get(key) || 0)) * 100) / 100;
    if (Math.abs(delta) < 0.005) continue;
    const template = targetByKey.get(key) || originalByKey.get(key);
    rows.push({
      agencyId: plan.agencyId,
      caseId,
      caseInvoiceId,
      timelineLegEvaluationId,
      incentivePlanId: plan.id,
      userId: template.userId,
      attributionKind: template.attributionKind,
      caseRoleId: template.caseRoleId || null,
      roleNameSnapshot: template.roleNameSnapshot || "Case role",
      sharePercentApplied: targetByKey.get(key)?.sharePercentApplied ?? template.sharePercentApplied,
      sourceAmountCollected: 0,
      creditedAmount: delta,
      triggerSource: PLAN_RECALCULATION_TRIGGER,
      triggerRef: correctionRef(plan, groupKey, key),
      entryType: "ADJUSTMENT",
      creditedAt,
    });
  }
  return rows;
}

async function loadPlan(agencyId, planId, db = prisma) {
  const plan = await db.incentivePlan.findFirst({ where: { id: planId, agencyId }, include: planInclude });
  if (!plan) throw new Error("Incentive plan not found.");
  return plan;
}

async function loadPaymentGroups(agencyId, planId, db = prisma) {
  const entries = await db.incentiveLedgerEntry.findMany({
    where: {
      agencyId,
      incentivePlanId: planId,
      caseInvoiceId: { not: null },
      entryType: { in: [...CREDIT_ENTRY_TYPES] },
      NOT: { triggerSource: PLAN_RECALCULATION_TRIGGER },
    },
    include: { reversalEntries: { select: { creditedAmount: true } } },
    orderBy: [{ creditedAt: "asc" }, { id: "asc" }],
  });
  const groups = new Map();
  for (const entry of entries) {
    const key = paymentGroupKey(entry);
    const group = groups.get(key) || { key, caseId: entry.caseId, caseInvoiceId: entry.caseInvoiceId, creditedAt: entry.creditedAt, sourceAmount: number(entry.sourceAmountCollected), entries: [] };
    group.entries.push(entry);
    groups.set(key, group);
  }
  return [...groups.values()];
}

async function loadTimelineGroups(agencyId, planId, db = prisma) {
  return db.incentiveTimelineLegEvaluation.findMany({
    where: { agencyId, incentivePlanId: planId },
    include: {
      ledgerEntries: {
        where: { entryType: "TIMELINE_BONUS", NOT: { triggerSource: PLAN_RECALCULATION_TRIGGER } },
        include: { reversalEntries: { select: { creditedAmount: true } } },
      },
    },
    orderBy: { evaluatedAt: "asc" },
  });
}

async function liveHoldersFor(agencyId, caseId) {
  return resolveHolders(agencyId, caseId);
}

function poolForPayment(plan, group, cumulativeAfter) {
  if (plan.formulaType === "FLAT_PER_PAYMENT") return number(plan.flatAmount);
  if (plan.formulaType === "PERCENT_OF_PAYMENT") return (group.sourceAmount * number(plan.percentRate)) / 100;
  const rate = tierRateFor(plan.tiers, cumulativeAfter);
  return rate === null ? 0 : (group.sourceAmount * rate) / 100;
}

async function buildPaymentCorrections(plan, groups) {
  const sorted = [...groups].sort((a, b) => new Date(a.creditedAt) - new Date(b.creditedAt));
  const cumulativeByCase = new Map();
  const corrections = [];
  const changes = [];
  for (const group of sorted) {
    const cumulativeAfter = (cumulativeByCase.get(group.caseId) || 0) + group.sourceAmount;
    cumulativeByCase.set(group.caseId, cumulativeAfter);
    const liveHolders = await liveHoldersFor(plan.agencyId, group.caseId);
    const historicalHolders = holdersForHistoricalGroup(plan, group.entries, liveHolders);
    const pool = poolForPayment(plan, group, cumulativeAfter);
    const targetEntries = pool > 0 ? computeSplits(plan, pool, historicalHolders) : [];
    const rows = correctionRows({ plan, groupKey: group.key, originalEntries: group.entries, targetEntries, creditedAt: group.creditedAt, caseId: group.caseId, caseInvoiceId: group.caseInvoiceId });
    const currentTotal = [...netByKey(group.entries).values()].reduce((sum, value) => sum + value, 0);
    const targetTotal = [...targetNetByKey(targetEntries, group.entries).values()].reduce((sum, value) => sum + value, 0);
    if (rows.length) corrections.push(...rows);
    changes.push({ kind: "PAYMENT", key: group.key, caseId: group.caseId, caseInvoiceId: group.caseInvoiceId, creditedAt: group.creditedAt, currentTotal, targetTotal, delta: Math.round((targetTotal - currentTotal) * 100) / 100, corrections: rows });
  }
  return { corrections, changes };
}

async function buildTimelineCorrections(plan, evaluations) {
  const legsByName = new Map();
  for (const leg of plan.timelineLegs) if (!legsByName.has(leg.name)) legsByName.set(leg.name, leg);
  const corrections = [];
  const changes = [];
  const unmatched = [];
  for (const evaluation of evaluations) {
    const leg = legsByName.get(evaluation.legNameSnapshot);
    if (!leg) {
      unmatched.push({ evaluationId: evaluation.id, legName: evaluation.legNameSnapshot });
      continue;
    }
    const liveHolders = await liveHoldersFor(plan.agencyId, evaluation.caseId);
    const historicalHolders = holdersForHistoricalGroup(plan, evaluation.ledgerEntries, liveHolders);
    const elapsedDays = Math.max(0, number(evaluation.elapsedMinutes) / 1440);
    const match = tierMultiplierFor(leg.tiers, elapsedDays);
    const pool = match ? (number(leg.baseBonusAmount) * number(match.multiplierPercent)) / 100 : 0;
    const targetEntries = pool > 0 ? computeSplits(plan, pool, historicalHolders) : [];
    const rows = correctionRows({ plan, groupKey: timelineGroupKey(evaluation), originalEntries: evaluation.ledgerEntries, targetEntries, creditedAt: evaluation.evaluatedAt, caseId: evaluation.caseId, caseInvoiceId: null, timelineLegEvaluationId: evaluation.id });
    const currentTotal = [...netByKey(evaluation.ledgerEntries).values()].reduce((sum, value) => sum + value, 0);
    const targetTotal = [...targetNetByKey(targetEntries, evaluation.ledgerEntries).values()].reduce((sum, value) => sum + value, 0);
    if (rows.length) corrections.push(...rows);
    changes.push({ kind: "TIMELINE", key: timelineGroupKey(evaluation), caseId: evaluation.caseId, timelineLegEvaluationId: evaluation.id, creditedAt: evaluation.evaluatedAt, currentTotal, targetTotal, delta: Math.round((targetTotal - currentTotal) * 100) / 100, corrections: rows });
  }
  return { corrections, changes, unmatched };
}

async function alreadyAppliedRefs(agencyId, refs, db = prisma) {
  if (!refs.length) return new Set();
  const rows = await db.incentiveLedgerEntry.findMany({ where: { agencyId, triggerSource: PLAN_RECALCULATION_TRIGGER, triggerRef: { in: refs } }, select: { triggerRef: true } });
  return new Set(rows.map((row) => row.triggerRef));
}

async function buildRecalculation(agencyId, planId, db = prisma) {
  const plan = await loadPlan(agencyId, planId, db);
  const [paymentGroups, timelineEvaluations] = await Promise.all([loadPaymentGroups(agencyId, planId, db), loadTimelineGroups(agencyId, planId, db)]);
  const [payment, timeline] = await Promise.all([buildPaymentCorrections(plan, paymentGroups), buildTimelineCorrections(plan, timelineEvaluations)]);
  const allCorrections = [...payment.corrections, ...timeline.corrections];
  const refs = allCorrections.map((row) => row.triggerRef);
  const appliedRefs = await alreadyAppliedRefs(agencyId, refs, db);
  const pendingCorrections = allCorrections.filter((row) => !appliedRefs.has(row.triggerRef));
  const pendingRefSet = new Set(pendingCorrections.map((row) => row.triggerRef));
  const changes = [...payment.changes, ...timeline.changes]
    .map((change) => ({ ...change, pending: change.corrections.some((row) => pendingRefSet.has(row.triggerRef)) }))
    .filter((change) => change.delta !== 0);
  return {
    plan,
    paymentGroups,
    timelineEvaluations,
    corrections: pendingCorrections,
    changes,
    unmatchedTimelineLegs: timeline.unmatched,
    appliedCount: allCorrections.length - pendingCorrections.length,
  };
}

function summarize(calculation) {
  const increases = calculation.corrections.filter((row) => number(row.creditedAmount) > 0).reduce((sum, row) => sum + number(row.creditedAmount), 0);
  const decreases = calculation.corrections.filter((row) => number(row.creditedAmount) < 0).reduce((sum, row) => sum + Math.abs(number(row.creditedAmount)), 0);
  return {
    plan: { id: calculation.plan.id, name: calculation.plan.name, version: calculation.plan.version },
    pending: calculation.corrections.length > 0,
    pendingCorrectionCount: calculation.corrections.length,
    alreadyAppliedCorrectionCount: calculation.appliedCount,
    increaseTotal: Math.round(increases * 100) / 100,
    decreaseTotal: Math.round(decreases * 100) / 100,
    netChange: Math.round((increases - decreases) * 100) / 100,
    paymentEventCount: calculation.paymentGroups.length,
    timelineEvaluationCount: calculation.timelineEvaluations.length,
    changedEventCount: calculation.changes.filter((change) => change.pending).length,
    unmatchedTimelineLegs: calculation.unmatchedTimelineLegs,
    changes: calculation.changes.filter((change) => change.pending).slice(0, 50).map((change) => ({
      kind: change.kind,
      caseId: change.caseId,
      caseInvoiceId: change.caseInvoiceId,
      timelineLegEvaluationId: change.timelineLegEvaluationId,
      creditedAt: change.creditedAt,
      currentTotal: change.currentTotal,
      targetTotal: change.targetTotal,
      delta: change.delta,
    })),
  };
}

export async function previewIncentivePlanRecalculation(agencyId, planId) {
  return summarize(await buildRecalculation(agencyId, planId));
}

export async function applyIncentivePlanRecalculation(agencyId, planId, actorUserId) {
  const calculation = await buildRecalculation(agencyId, planId);
  if (!calculation.corrections.length) return { ...summarize(calculation), applied: 0, snapshotCount: 0 };

  const appliedRows = await prisma.$transaction(async (tx) => {
    const existing = await tx.incentiveLedgerEntry.findMany({
      where: { agencyId, triggerSource: PLAN_RECALCULATION_TRIGGER, triggerRef: { in: calculation.corrections.map((row) => row.triggerRef) } },
      select: { triggerRef: true },
    });
    const existingRefs = new Set(existing.map((row) => row.triggerRef));
    const rows = calculation.corrections.filter((row) => !existingRefs.has(row.triggerRef));
    if (rows.length) await tx.incentiveLedgerEntry.createMany({ data: rows });
    return rows;
  });

  let snapshotCount = 0;
  if (calculation.plan.isActive) {
    const invoices = await prisma.caseInvoice.findMany({
      where: { agencyId, incentiveSnapshot: { is: { incentivePlanId: calculation.plan.id } }, status: { notIn: ["Void", "Voided"] } },
      select: { id: true, caseId: true, incentiveSnapshot: { select: { id: true } } },
    });
    for (const invoice of invoices) {
      const snapshot = await buildInvoiceIncentiveSnapshotForPlan(agencyId, invoice.caseId, calculation.plan.id);
      if (!snapshot || !invoice.incentiveSnapshot?.id) continue;
      await prisma.caseInvoiceIncentiveSnapshot.update({ where: { id: invoice.incentiveSnapshot.id }, data: snapshot });
      snapshotCount += 1;
    }
  }

  const result = summarize({ ...calculation, corrections: appliedRows });
  await recordActivity({
    agencyId,
    userId: actorUserId,
    action: "incentive.plan_recalculation",
    details: `${calculation.plan.name} v${calculation.plan.version} recalculated ${appliedRows.length} historical incentive adjustment${appliedRows.length === 1 ? "" : "s"}; net change ${result.netChange >= 0 ? "+" : ""}$${result.netChange.toFixed(2)}`,
    entityType: "incentivePlan",
    entityId: calculation.plan.id,
    metadata: { planId: calculation.plan.id, planVersion: calculation.plan.version, applied: appliedRows.length, snapshotCount, increaseTotal: result.increaseTotal, decreaseTotal: result.decreaseTotal, netChange: result.netChange },
  });
  return { ...result, applied: appliedRows.length, snapshotCount };
}
