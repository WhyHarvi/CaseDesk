import prisma from "./prisma/client.js";
import { logger } from "./logger.js";
import { resolvePlan, resolveHolders, computeSplits } from "./incentiveCreditingService.js";

const legInclude = { tiers: { orderBy: { thresholdDays: "asc" } } };

export async function fetchPlanTimelineLegs(planId) {
  return prisma.incentivePlanTimelineLeg.findMany({ where: { planId }, include: legInclude, orderBy: { sortOrder: "asc" } });
}

async function resolveCheckpointTimestamp(agencyId, caseId, checkpointType, checkpointValue) {
  if (checkpointType === "LEAD_CREATED") {
    const lead = await prisma.lead.findFirst({ where: { convertedCaseId: caseId, agencyId }, select: { createdAt: true } });
    return lead?.createdAt || null;
  }
  if (checkpointType === "LEAD_STAGE_REACHED") {
    const lead = await prisma.lead.findFirst({ where: { convertedCaseId: caseId, agencyId }, select: { id: true } });
    if (!lead) return null;
    const row = await prisma.leadStageHistory.findFirst({
      where: { agencyId, leadId: lead.id, newStage: checkpointValue },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });
    return row?.createdAt || null;
  }
  if (checkpointType === "CASE_STAGE_REACHED") {
    const row = await prisma.caseStageHistory.findFirst({
      where: { agencyId, caseId, newStage: checkpointValue },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });
    return row?.createdAt || null;
  }
  if (checkpointType === "FIRST_PAYMENT_COLLECTED") {
    const row = await prisma.incentiveLedgerEntry.findFirst({
      where: { agencyId, caseId, entryType: "CREDIT" },
      orderBy: { creditedAt: "asc" },
      select: { creditedAt: true },
    });
    return row?.creditedAt || null;
  }
  return null;
}

// Batched form of resolveCheckpointTimestamp — one query per checkpoint
// TYPE actually referenced (at most 4), instead of one query per leg per
// case. requests: [{ caseId, checkpointType, checkpointValue }]. Returns a
// Map keyed by `${caseId}:${checkpointType}:${checkpointValue ?? ""}`.
async function resolveCheckpointTimestampsBatch(agencyId, requests) {
  const results = new Map();
  const key = (caseId, type, value) => `${caseId}:${type}:${value ?? ""}`;

  const caseIdsFor = (type) => [...new Set(requests.filter((row) => row.checkpointType === type).map((row) => row.caseId))];
  const leadCreatedCaseIds = caseIdsFor("LEAD_CREATED");
  const leadStageCaseIds = caseIdsFor("LEAD_STAGE_REACHED");
  const caseStageCaseIds = caseIdsFor("CASE_STAGE_REACHED");
  const firstPaymentCaseIds = caseIdsFor("FIRST_PAYMENT_COLLECTED");

  const [leadCreatedRows, leadsForStage, caseStageRows, firstPaymentRows] = await Promise.all([
    leadCreatedCaseIds.length
      ? prisma.lead.findMany({ where: { convertedCaseId: { in: leadCreatedCaseIds }, agencyId }, select: { convertedCaseId: true, createdAt: true } })
      : [],
    leadStageCaseIds.length
      ? prisma.lead.findMany({ where: { convertedCaseId: { in: leadStageCaseIds }, agencyId }, select: { convertedCaseId: true, id: true } })
      : [],
    caseStageCaseIds.length
      ? prisma.caseStageHistory.groupBy({ by: ["caseId", "newStage"], where: { agencyId, caseId: { in: caseStageCaseIds } }, _min: { createdAt: true } })
      : [],
    firstPaymentCaseIds.length
      ? prisma.incentiveLedgerEntry.groupBy({ by: ["caseId"], where: { agencyId, caseId: { in: firstPaymentCaseIds }, entryType: "CREDIT" }, _min: { creditedAt: true } })
      : [],
  ]);

  for (const row of leadCreatedRows) results.set(key(row.convertedCaseId, "LEAD_CREATED", ""), row.createdAt);

  if (leadStageCaseIds.length) {
    const leadIdByCaseId = new Map(leadsForStage.map((row) => [row.convertedCaseId, row.id]));
    const caseIdByLeadId = new Map([...leadIdByCaseId.entries()].map(([caseId, leadId]) => [leadId, caseId]));
    const leadIds = [...leadIdByCaseId.values()];
    const stageRows = leadIds.length
      ? await prisma.leadStageHistory.groupBy({ by: ["leadId", "newStage"], where: { agencyId, leadId: { in: leadIds } }, _min: { createdAt: true } })
      : [];
    for (const row of stageRows) {
      const caseId = caseIdByLeadId.get(row.leadId);
      if (caseId) results.set(key(caseId, "LEAD_STAGE_REACHED", row.newStage), row._min.createdAt);
    }
  }

  for (const row of caseStageRows) results.set(key(row.caseId, "CASE_STAGE_REACHED", row.newStage), row._min.createdAt);
  for (const row of firstPaymentRows) results.set(key(row.caseId, "FIRST_PAYMENT_COLLECTED", ""), row._min.creditedAt);

  return results;
}

// Batched form of projectCaseTimelineLegs for list endpoints (getActiveTimelines)
// that project many cases in one request — same per-case output, but the
// evaluations/ledger/checkpoint lookups each run once across every case
// instead of once per case. casesWithLegs: [{ caseId, legs }]. Returns a
// Map keyed by caseId.
export async function projectCaseTimelineLegsBatch(agencyId, casesWithLegs) {
  const caseIds = casesWithLegs.map((row) => row.caseId);
  const evaluations = caseIds.length
    ? await prisma.incentiveTimelineLegEvaluation.findMany({ where: { agencyId, caseId: { in: caseIds } } })
    : [];
  const evaluationsByCaseId = new Map();
  for (const row of evaluations) {
    const bucket = evaluationsByCaseId.get(row.caseId) || [];
    bucket.push(row);
    evaluationsByCaseId.set(row.caseId, bucket);
  }

  const creditedEvaluationIds = evaluations.filter((row) => row.outcome === "CREDITED").map((row) => row.id);
  const ledgerRows = creditedEvaluationIds.length
    ? await prisma.incentiveLedgerEntry.findMany({
        where: { timelineLegEvaluationId: { in: creditedEvaluationIds }, entryType: "TIMELINE_BONUS" },
        select: { timelineLegEvaluationId: true, userId: true, roleNameSnapshot: true, creditedAmount: true, user: { select: { fullName: true } } },
      })
    : [];
  const recipientsByEvaluationId = new Map();
  for (const row of ledgerRows) {
    const bucket = recipientsByEvaluationId.get(row.timelineLegEvaluationId) || [];
    bucket.push({ userId: row.userId, fullName: row.user.fullName, roleNameSnapshot: row.roleNameSnapshot, creditedAmount: Number(row.creditedAmount) });
    recipientsByEvaluationId.set(row.timelineLegEvaluationId, bucket);
  }

  const checkpointRequests = [];
  for (const { caseId, legs } of casesWithLegs) {
    const evaluationByLegId = new Map((evaluationsByCaseId.get(caseId) || []).map((row) => [row.legId, row]));
    for (const leg of legs) {
      if (evaluationByLegId.has(leg.id)) continue;
      checkpointRequests.push({ caseId, checkpointType: leg.fromCheckpointType, checkpointValue: leg.fromCheckpointValue });
    }
  }
  const checkpointTimestamps = await resolveCheckpointTimestampsBatch(agencyId, checkpointRequests);

  const resultByCaseId = new Map();
  for (const { caseId, legs } of casesWithLegs) {
    const evaluationByLegId = new Map((evaluationsByCaseId.get(caseId) || []).map((row) => [row.legId, row]));
    const result = [];
    const consumedLegIds = new Set();
    for (const leg of legs) {
      const evaluation = evaluationByLegId.get(leg.id);
      if (evaluation) {
        consumedLegIds.add(leg.id);
        result.push(resolvedLegEntry(evaluation, recipientsByEvaluationId));
        continue;
      }
      const fromAt = checkpointTimestamps.get(`${caseId}:${leg.fromCheckpointType}:${leg.fromCheckpointValue ?? ""}`) || null;
      const tiers = leg.tiers.map((tier) => ({ id: tier.id, thresholdDays: Number(tier.thresholdDays), multiplierPercent: Number(tier.multiplierPercent) }));
      if (!fromAt) {
        result.push({ legId: leg.id, name: leg.name, sortOrder: leg.sortOrder, state: "NOT_STARTED", fromCheckpointType: leg.fromCheckpointType, fromCheckpointValue: leg.fromCheckpointValue, baseBonusAmount: Number(leg.baseBonusAmount), tiers });
        continue;
      }
      result.push({ legId: leg.id, name: leg.name, sortOrder: leg.sortOrder, state: "IN_PROGRESS", fromCheckpointAt: fromAt, baseBonusAmount: Number(leg.baseBonusAmount), tiers });
    }
    for (const evaluation of evaluationsByCaseId.get(caseId) || []) {
      if (consumedLegIds.has(evaluation.legId)) continue;
      result.push(resolvedLegEntry(evaluation, recipientsByEvaluationId));
    }
    resultByCaseId.set(caseId, result);
  }
  return resultByCaseId;
}

// Mirror image of tierRateFor (incentiveCreditingService.js): the SMALLEST
// thresholdDays that still covers the actual elapsed time wins (the loosest
// tier the case qualified for), not the largest threshold cleared. Tiers
// must already be sorted ascending — every caller here sources them via
// legInclude/planInclude, which both order by thresholdDays asc.
export function tierMultiplierFor(tiers, elapsedDays) {
  for (const tier of tiers) {
    if (Number(tier.thresholdDays) >= elapsedDays) return { tierId: tier.id, multiplierPercent: Number(tier.multiplierPercent) };
  }
  return null;
}

// Re-scans EVERY leg on the case's resolved plan rather than reacting to a
// single checkpoint — deliberately. A LEAD_STAGE_REACHED-anchored leg can't
// be evaluated at the moment the lead stage actually changes, because plan
// resolution needs caseType, which doesn't exist until a case exists. By
// re-checking every not-yet-evaluated leg on every hook firing (lead
// conversion, case stage change, payment collection), a leg simply resolves
// on whichever hook happens to fire after both its endpoints exist —
// self-healing CHK's "early client" case-before-conversion path for free.
// Best-effort: every call site wraps this in its own .catch(), matching the
// existing payment-crediting hooks.
export async function evaluateCaseTimelineLegs(agencyId, caseId) {
  const caseItem = await prisma.case.findFirst({ where: { id: caseId, agencyId }, select: { caseType: true } });
  if (!caseItem) return { evaluated: 0 };

  const plan = await resolvePlan(agencyId, caseItem.caseType);
  if (!plan) return { evaluated: 0 };

  const legs = await prisma.incentivePlanTimelineLeg.findMany({ where: { planId: plan.id }, include: legInclude });
  if (!legs.length) return { evaluated: 0 };

  const alreadyEvaluated = await prisma.incentiveTimelineLegEvaluation.findMany({
    where: { caseId, legId: { in: legs.map((leg) => leg.id) } },
    select: { legId: true },
  });
  const doneLegIds = new Set(alreadyEvaluated.map((row) => row.legId));
  const pendingLegs = legs.filter((leg) => !doneLegIds.has(leg.id));
  if (!pendingLegs.length) return { evaluated: 0 };

  let evaluated = 0;
  for (const leg of pendingLegs) {
    const [fromAt, toAt] = await Promise.all([
      resolveCheckpointTimestamp(agencyId, caseId, leg.fromCheckpointType, leg.fromCheckpointValue),
      resolveCheckpointTimestamp(agencyId, caseId, leg.toCheckpointType, leg.toCheckpointValue),
    ]);
    // Either endpoint hasn't happened yet — not a miss, just not
    // resolvable yet. Try again next time something touches this case.
    if (!fromAt || !toAt) continue;

    const elapsedMs = toAt.getTime() - fromAt.getTime();
    const elapsedMinutes = Math.round(elapsedMs / 60000);

    if (elapsedMs < 0) {
      // A real anomaly (e.g. a backfilled/out-of-order stage-history row) —
      // logged, never inverted or clamped to 0, so it stays visible in the
      // audit trail instead of silently reading as an instant completion.
      logger.warn("incentive.timeline_leg_negative_elapsed", { agencyId, caseId, legId: leg.id, fromAt, toAt });
    }

    const match = elapsedMs >= 0 ? tierMultiplierFor(leg.tiers, elapsedMs / 86_400_000) : null;
    const multiplierPercent = match?.multiplierPercent ?? 0;
    const pool = (Number(leg.baseBonusAmount) * multiplierPercent) / 100;

    let outcome = "MISSED_TIMELINE";
    let creditedTotal = 0;
    let ledgerRows = [];
    if (pool > 0) {
      const holders = await resolveHolders(agencyId, caseId);
      const splits = computeSplits(plan, pool, holders);
      if (splits.length) {
        outcome = "CREDITED";
        creditedTotal = splits.reduce((sum, entry) => sum + entry.amount, 0);
        ledgerRows = splits;
      } else {
        outcome = "MISSED_NO_HOLDERS";
      }
    }

    const evaluatedAt = new Date();
    try {
      await prisma.$transaction(async (tx) => {
        const evaluation = await tx.incentiveTimelineLegEvaluation.create({
          data: {
            agencyId,
            caseId,
            legId: leg.id,
            legNameSnapshot: leg.name,
            incentivePlanId: plan.id,
            fromCheckpointAt: fromAt,
            toCheckpointAt: toAt,
            elapsedMinutes,
            matchedTierId: match?.tierId ?? null,
            multiplierPercent: match ? multiplierPercent : null,
            baseBonusAmount: leg.baseBonusAmount,
            creditedTotal,
            outcome,
          },
        });
        if (ledgerRows.length) {
          await tx.incentiveLedgerEntry.createMany({
            data: ledgerRows.map((entry) => ({
              agencyId,
              caseId,
              caseInvoiceId: null,
              timelineLegEvaluationId: evaluation.id,
              incentivePlanId: plan.id,
              userId: entry.userId,
              attributionKind: entry.attributionKind,
              caseRoleId: entry.caseRoleId,
              roleNameSnapshot: entry.roleNameSnapshot,
              sharePercentApplied: entry.sharePercentApplied,
              sourceAmountCollected: 0,
              creditedAmount: entry.amount,
              triggerSource: leg.toCheckpointType,
              triggerRef: `leg:${leg.id}`,
              entryType: "TIMELINE_BONUS",
              creditedAt: evaluatedAt,
            })),
          });
        }
      });
      evaluated += 1;
      if (outcome === "CREDITED") {
        logger.info("incentive.timeline_leg_credited", { agencyId, caseId, legId: leg.id, creditedTotal });
      }
    } catch (error) {
      // A concurrent call already evaluated this leg — fine, move on.
      if (error?.code !== "P2002") throw error;
    }
  }
  return { evaluated };
}

function resolvedLegEntry(evaluation, recipientsByEvaluationId) {
  return {
    legId: evaluation.legId,
    name: evaluation.legNameSnapshot,
    state: "RESOLVED",
    outcome: evaluation.outcome,
    creditedTotal: Number(evaluation.creditedTotal),
    multiplierPercent: evaluation.multiplierPercent === null ? null : Number(evaluation.multiplierPercent),
    elapsedMinutes: evaluation.elapsedMinutes,
    baseBonusAmount: Number(evaluation.baseBonusAmount),
    evaluatedAt: evaluation.evaluatedAt,
    recipients: recipientsByEvaluationId.get(evaluation.id) || [],
  };
}

// Read-only projection for display — never writes anything. Given a case's
// CURRENT live legs (from whatever plan is active right now), tags each
// with a display state. Deliberately re-derives this from the case's full
// evaluation history rather than trusting `legs` alone: IncentivePlanTimelineLeg
// rows are deleted and recreated whole on every plan save, so a case's real
// evaluation history can reference legIds that no longer exist on the live
// plan — filtering by current leg IDs would silently drop real
// credited/missed history from a widget built on top of this.
export async function projectCaseTimelineLegs(agencyId, caseId, legs) {
  const evaluations = await prisma.incentiveTimelineLegEvaluation.findMany({ where: { agencyId, caseId } });
  const evaluationByLegId = new Map(evaluations.map((row) => [row.legId, row]));

  const creditedEvaluationIds = evaluations.filter((row) => row.outcome === "CREDITED").map((row) => row.id);
  const ledgerRows = creditedEvaluationIds.length
    ? await prisma.incentiveLedgerEntry.findMany({
        where: { timelineLegEvaluationId: { in: creditedEvaluationIds }, entryType: "TIMELINE_BONUS" },
        select: { timelineLegEvaluationId: true, userId: true, roleNameSnapshot: true, creditedAmount: true, user: { select: { fullName: true } } },
      })
    : [];
  const recipientsByEvaluationId = new Map();
  for (const row of ledgerRows) {
    const bucket = recipientsByEvaluationId.get(row.timelineLegEvaluationId) || [];
    bucket.push({ userId: row.userId, fullName: row.user.fullName, roleNameSnapshot: row.roleNameSnapshot, creditedAmount: Number(row.creditedAmount) });
    recipientsByEvaluationId.set(row.timelineLegEvaluationId, bucket);
  }

  const result = [];
  const consumedLegIds = new Set();
  for (const leg of legs) {
    const evaluation = evaluationByLegId.get(leg.id);
    if (evaluation) {
      consumedLegIds.add(leg.id);
      result.push(resolvedLegEntry(evaluation, recipientsByEvaluationId));
      continue;
    }
    // Deliberately never resolves toCheckpointType here — display doesn't
    // need it, and it saves a query per leg on every case-profile load.
    const fromAt = await resolveCheckpointTimestamp(agencyId, caseId, leg.fromCheckpointType, leg.fromCheckpointValue);
    const tiers = leg.tiers.map((tier) => ({ id: tier.id, thresholdDays: Number(tier.thresholdDays), multiplierPercent: Number(tier.multiplierPercent) }));
    if (!fromAt) {
      result.push({
        legId: leg.id,
        name: leg.name,
        sortOrder: leg.sortOrder,
        state: "NOT_STARTED",
        fromCheckpointType: leg.fromCheckpointType,
        fromCheckpointValue: leg.fromCheckpointValue,
        baseBonusAmount: Number(leg.baseBonusAmount),
        tiers,
      });
      continue;
    }
    result.push({
      legId: leg.id,
      name: leg.name,
      sortOrder: leg.sortOrder,
      state: "IN_PROGRESS",
      fromCheckpointAt: fromAt,
      baseBonusAmount: Number(leg.baseBonusAmount),
      tiers,
    });
  }

  // Orphaned evaluations — their leg no longer exists on the live plan
  // (legs are deleted-and-recreated whole on every plan save), but the
  // real credited/missed history must still show up here. This also means
  // a fully-deactivated plan (legs = []) still shows a case's true past
  // bonuses, since this function always runs its own evaluations query
  // regardless of what `legs` it's handed.
  for (const evaluation of evaluations) {
    if (consumedLegIds.has(evaluation.legId)) continue;
    result.push(resolvedLegEntry(evaluation, recipientsByEvaluationId));
  }

  return result;
}

// One-case orchestrator for the Case Profile widget. Never throws — a
// missing case or missing plan just returns an empty projection, matching
// evaluateCaseTimelineLegs's soft-fail style.
export async function estimateCaseTimelineProgress(agencyId, caseId) {
  const caseItem = await prisma.case.findFirst({ where: { id: caseId, agencyId }, select: { caseType: true } });
  if (!caseItem) return { planId: null, planName: null, legs: [] };

  const plan = await resolvePlan(agencyId, caseItem.caseType);
  const legs = plan ? await fetchPlanTimelineLegs(plan.id) : [];

  return {
    planId: plan?.id ?? null,
    planName: plan?.name ?? null,
    legs: await projectCaseTimelineLegs(agencyId, caseId, legs),
  };
}
