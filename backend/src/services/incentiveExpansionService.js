import prisma from "./prisma/client.js";
import { reportingBounds } from "../modules/leads/lead.metrics.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { computeSplits, resolveHolders } from "./incentiveCreditingService.js";
import { logger } from "./logger.js";

export const STUDY_PERMIT_MILESTONES = Object.freeze({
  "Offer Letter Application Submitted": "COLLEGE_APPLICATION_SUBMITTED",
  Submitted: "STUDY_PERMIT_APPLICATION_SUBMITTED",
});
export const POST_SUBMISSION_FOLLOW_UP_TYPE = "Post-submission follow-up";
export const REVENUE_CATEGORIES = ["PROFESSIONAL_FEE", "COLLEGE_FEE", "GOVERNMENT_FEE", "DISBURSEMENT", "OTHER"];
export const ELIGIBLE_REVENUE_CATEGORIES = new Set(["PROFESSIONAL_FEE"]);

const cents = (value) => Math.round(Number(value || 0) * 100);
const money = (value) => cents(value) / 100;

export function rankRevenueCredits(rows) {
  const users = new Map();
  for (const row of rows) {
    const bucket = users.get(row.revenueOwnerId) || {
      userId: row.revenueOwnerId,
      fullName: row.revenueOwnerSnapshot,
      netRevenueCents: 0,
      paidCaseIds: new Set(),
      reachedAt: null,
    };
    bucket.netRevenueCents += cents(row.netAmount);
    if (Number(row.netAmount) > 0) bucket.paidCaseIds.add(row.caseId);
    const at = new Date(row.collectedAt);
    if (!bucket.reachedAt || at > bucket.reachedAt) bucket.reachedAt = at;
    users.set(row.revenueOwnerId, bucket);
  }
  return [...users.values()].map((row) => ({
    userId: row.userId,
    fullName: row.fullName,
    netRevenue: row.netRevenueCents / 100,
    paidCaseCount: row.paidCaseIds.size,
    reachedAt: row.reachedAt,
  })).filter((row) => row.netRevenue > 0).sort((a, b) =>
    b.netRevenue - a.netRevenue
    || b.paidCaseCount - a.paidCaseCount
    || new Date(a.reachedAt) - new Date(b.reachedAt)
    || a.userId.localeCompare(b.userId));
}

export function contestWinners(ranking) {
  if (!ranking.length) return [];
  const first = ranking[0];
  return ranking.filter((row) => row.netRevenue === first.netRevenue
    && row.paidCaseCount === first.paidCaseCount
    && new Date(row.reachedAt).getTime() === new Date(first.reachedAt).getTime());
}

export function contestPrizeShares({ prizeType, prizeValue, winners }) {
  if (!winners.length) return [];
  const totalCents = prizeType === "PERCENT_OF_WINNER_REVENUE"
    ? Math.round(cents(winners[0].netRevenue) * Number(prizeValue) / 100)
    : cents(prizeValue);
  const base = Math.floor(totalCents / winners.length);
  let remainder = totalCents - base * winners.length;
  return [...winners].sort((a, b) => a.userId.localeCompare(b.userId)).map((winner) => ({
    ...winner,
    prizeAmount: (base + (remainder-- > 0 ? 1 : 0)) / 100,
  }));
}

async function agencyPeriodBounds(agencyId, now = new Date(), db = prisma) {
  const agency = await db.agency.findUnique({ where: { id: agencyId }, select: { timezone: true } });
  const timezone = agency?.timezone || "America/Toronto";
  const { monthStart, nextMonthStart } = reportingBounds(now, timezone);
  const label = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, month: "long", year: "numeric" }).format(now);
  return { startsAt: monthStart, endsAt: nextMonthStart, label, timezone };
}

export async function getOrCreateActiveIncentivePeriod(agencyId, now = new Date(), db = prisma) {
  const active = await db.incentivePeriod.findFirst({
    where: { agencyId, status: "ACTIVE", startsAt: { lte: now }, endsAt: { gt: now } },
    orderBy: { startsAt: "desc" },
  });
  if (active) return active;
  const bounds = await agencyPeriodBounds(agencyId, now, db);
  return db.incentivePeriod.upsert({
    where: { agencyId_startsAt: { agencyId, startsAt: bounds.startsAt } },
    create: { agencyId, label: bounds.label, startsAt: bounds.startsAt, endsAt: bounds.endsAt },
    update: {},
  });
}

export async function closeIncentivePeriod(agencyId, actorUserId, reason, now = new Date()) {
  const explanation = String(reason || "").trim().slice(0, 500);
  if (!explanation) throw createHttpError(400, "A reason is required to close an incentive period.", "CLOSE_REASON_REQUIRED");
  const result = await prisma.$transaction(async (tx) => {
    const active = await getOrCreateActiveIncentivePeriod(agencyId, now, tx);
    if (active.startsAt >= now) throw createHttpError(409, "This period has already been restarted at this time.", "PERIOD_ALREADY_RESTARTED");
    const closed = await tx.incentivePeriod.update({
      where: { id: active.id }, data: { endsAt: now, status: "CLOSED", closedById: actorUserId, closedReason: explanation, closedAt: now },
    });
    const calendar = await agencyPeriodBounds(agencyId, now, tx);
    const periodCount = await tx.incentivePeriod.count({
      where: { agencyId, startsAt: { gte: calendar.startsAt }, endsAt: { lte: calendar.endsAt } },
    });
    const next = await tx.incentivePeriod.create({
      data: { agencyId, label: `${calendar.label} · Period ${periodCount + 1}`, startsAt: now, endsAt: calendar.endsAt },
    });
    return { closed, active: next };
  });
  await recordActivity({ agencyId, userId: actorUserId, action: "incentive.period_closed", details: explanation,
    entityType: "incentive_period", entityId: result.closed.id, metadata: { nextPeriodId: result.active.id } });
  return result;
}

export async function ensureIncentiveCycle(agencyId, caseId, actorUserId = null, db = prisma) {
  const existing = await db.incentiveCycle.findFirst({ where: { agencyId, caseId, status: "ACTIVE" }, orderBy: { sequence: "desc" } });
  if (existing) return existing;
  return db.incentiveCycle.create({ data: { agencyId, caseId, sequence: 1, cycleType: "ORIGINAL", createdById: actorUserId } });
}

export async function createReapplicationCycle(agencyId, caseId, actorUserId, { incentiveEligible, reason }) {
  if (typeof incentiveEligible !== "boolean") throw createHttpError(400, "Choose whether this reapplication is incentive-eligible.", "ELIGIBILITY_REQUIRED");
  const explanation = String(reason || "").trim().slice(0, 500);
  if (!explanation) throw createHttpError(400, "Explain the reapplication eligibility decision.", "ELIGIBILITY_REASON_REQUIRED");
  const cycle = await prisma.$transaction(async (tx) => {
    const item = await tx.case.findFirst({ where: { id: caseId, agencyId, caseType: { contains: "Study Permit", mode: "insensitive" } }, select: { id: true } });
    if (!item) throw createHttpError(404, "Study Permit case not found.", "NOT_FOUND");
    const previous = await tx.incentiveCycle.findMany({ where: { agencyId, caseId }, orderBy: { sequence: "desc" }, take: 1 });
    await tx.incentiveCycle.updateMany({ where: { agencyId, caseId, status: "ACTIVE" }, data: { status: "CLOSED", closedAt: new Date() } });
    return tx.incentiveCycle.create({ data: { agencyId, caseId, sequence: (previous[0]?.sequence || 0) + 1, cycleType: "REAPPLICATION",
      incentiveEligible, eligibilityReason: explanation, createdById: actorUserId } });
  });
  await recordActivity({ agencyId, userId: actorUserId, caseId, action: "incentive.reapplication_cycle_created", details: explanation,
    entityType: "incentive_cycle", entityId: cycle.id, metadata: { incentiveEligible } });
  return cycle;
}

export async function creditStudyPermitMilestone(agencyId, { caseId, eventType, triggerSource, triggerRef, occurredAt = new Date(), actorUserId = null }) {
  const caseItem = await prisma.case.findFirst({
    where: { id: caseId, agencyId, caseType: { contains: "Study Permit", mode: "insensitive" }, deletedAt: null },
    select: { id: true, caseType: true },
  });
  if (!caseItem) return { credited: false, reason: "not_study_permit" };
  const plan = await prisma.incentivePlan.findFirst({
    where: { agencyId, isActive: true, caseType: caseItem.caseType }, include: { roleShares: true, milestoneRules: true },
  }) || await prisma.incentivePlan.findFirst({
    where: { agencyId, isActive: true, caseType: null }, include: { roleShares: true, milestoneRules: true },
  });
  const rule = plan?.milestoneRules.find((item) => item.eventType === eventType && item.isActive);
  if (!plan || !rule) return { credited: false, reason: "no_active_rule" };
  const cycle = await ensureIncentiveCycle(agencyId, caseId, actorUserId);
  if (!cycle.incentiveEligible) return { credited: false, reason: "cycle_ineligible" };
  const effectiveTriggerRef = `${cycle.id}:${String(triggerRef)}`;
  const period = await getOrCreateActiveIncentivePeriod(agencyId, occurredAt);
  const holders = await resolveHolders(agencyId, caseId);
  const incentivePool = money(Number(rule.flatAmount) * Number(rule.payoutPercent) / 100);
  const splits = computeSplits(plan, incentivePool, holders);
  try {
    return await prisma.$transaction(async (tx) => {
      const evaluation = await tx.incentiveMilestoneEvaluation.create({ data: { agencyId, caseId, incentiveCycleId: cycle.id,
        incentivePlanId: plan.id, milestoneRuleId: rule.id, eventType, eventNameSnapshot: rule.name, amountSnapshot: rule.flatAmount,
        payoutPercentSnapshot: rule.payoutPercent,
        triggerSource, triggerRef: effectiveTriggerRef, occurredAt } });
      if (splits.length) await tx.incentiveLedgerEntry.createMany({ data: splits.map((split) => ({ agencyId, caseId,
        incentivePlanId: plan.id, userId: split.userId, attributionKind: split.attributionKind, caseRoleId: split.caseRoleId,
        roleNameSnapshot: split.roleNameSnapshot, sharePercentApplied: split.sharePercentApplied, sourceAmountCollected: rule.flatAmount,
        creditedAmount: split.amount, triggerSource, triggerRef: effectiveTriggerRef, entryType: "MILESTONE_CREDIT", creditedAt: occurredAt,
        incentiveCycleId: cycle.id, incentivePeriodId: period.id, planNameSnapshot: plan.name, planVersionSnapshot: plan.version,
        formulaTypeSnapshot: "PERCENT_OF_MILESTONE_SOURCE", calculationSnapshot: { eventType, ruleName: rule.name,
          collegeIncentiveAmount: Number(rule.flatAmount), consultantPercent: Number(rule.payoutPercent), grossPool: incentivePool } })) });
      return { credited: true, entryCount: splits.length, evaluationId: evaluation.id };
    });
  } catch (error) {
    if (error?.code === "P2002") return { credited: false, reason: "already_credited" };
    throw error;
  }
}

// Queues a durable record that a qualifying milestone event happened, BEFORE
// creditStudyPermitMilestone is attempted. Callers that have a transaction
// spanning the underlying case/follow-up write (updateCase, the lifecycle
// "Submitted" transition) pass its `tx` so the row is guaranteed to exist
// the instant that state change commits — no window where the case has
// moved but nothing durable records that a milestone credit is owed.
// Callers without a reachable transaction (the generic follow-up CRUD
// helper, which commits its update before running afterUpdate) pass the
// default `prisma` client and accept a small gap instead of losing the
// event outright on any crediting failure. Safe to call more than once for
// the same real-world event — the unique constraint matches
// IncentiveMilestoneEvaluation's own trigger key, so a duplicate call is a
// no-op rather than a second queued retry.
export async function recordPendingStudyPermitMilestoneEvent(agencyId, { caseId, eventType, triggerSource, triggerRef, occurredAt = new Date(), actorUserId = null }, db = prisma) {
  try {
    return await db.incentiveMilestoneEvent.create({
      data: { agencyId, caseId, eventType, triggerSource, triggerRef: String(triggerRef), occurredAt, actorUserId, status: "PENDING" },
    });
  } catch (error) {
    if (error?.code === "P2002") return null;
    throw error;
  }
}

// Runs the queued crediting attempt for one pending event and closes it out.
// creditStudyPermitMilestone returning at all — credited, already_credited,
// or a definitive "nothing to do" reason like no_active_rule/cycle_ineligible
// — means it made its own idempotent decision, so the row is marked
// PROCESSED either way. Only an actual thrown error (a transient DB/network
// failure) leaves it PENDING for the next sweep.
export async function processPendingStudyPermitMilestoneEvent(eventId) {
  const event = await prisma.incentiveMilestoneEvent.findUnique({ where: { id: eventId } });
  if (!event || event.status !== "PENDING") return null;
  try {
    const result = await creditStudyPermitMilestone(event.agencyId, {
      caseId: event.caseId, eventType: event.eventType, triggerSource: event.triggerSource,
      triggerRef: event.triggerRef, occurredAt: event.occurredAt, actorUserId: event.actorUserId,
    });
    await prisma.incentiveMilestoneEvent.update({
      where: { id: event.id }, data: { status: "PROCESSED", processedAt: new Date(), lastError: null },
    });
    return result;
  } catch (error) {
    await prisma.incentiveMilestoneEvent.update({
      where: { id: event.id }, data: { attempts: { increment: 1 }, lastError: String(error?.message || error).slice(0, 500) },
    }).catch(() => {});
    throw error;
  }
}

// Hourly sweep counterpart to reconcilePendingIncentiveCredits: picks up any
// milestone event whose immediate best-effort crediting attempt threw
// (network blip, DB hiccup) and retries it. Oldest first, capped per run so
// one bad backlog can't monopolize the shared retry worker.
export async function reconcilePendingStudyPermitMilestoneEvents(limit = 100) {
  const rows = await prisma.incentiveMilestoneEvent.findMany({
    where: { status: "PENDING" }, orderBy: { createdAt: "asc" }, take: limit, select: { id: true, caseId: true },
  });
  for (const row of rows) {
    await processPendingStudyPermitMilestoneEvent(row.id).catch((error) =>
      logger.warn("incentive.milestone_retry_failed", { eventId: row.id, caseId: row.caseId, reason: error.message }));
  }
  return rows.length;
}

export async function simulateIncentivePlan(agencyId, { planId, dateFrom, dateTo, caseType, userId, caseId }) {
  const plan = await prisma.incentivePlan.findFirst({ where: { id: planId, agencyId }, include: { roleShares: true, milestoneRules: true, tiers: true } });
  if (!plan) throw createHttpError(404, "Incentive plan not found.", "NOT_FOUND");
  const cases = await prisma.case.findMany({ where: { agencyId, deletedAt: null,
    ...(caseType ? { caseType } : {}), ...(caseId ? { id: caseId } : {}) },
    select: { id: true, caseType: true, assignedUserId: true, client: { select: { fullName: true } } } });
  const rows = [];
  for (const item of cases) {
    const holders = await resolveHolders(agencyId, item.id);
    for (const rule of plan.milestoneRules.filter((entry) => entry.isActive)) {
      const incentivePool = money(Number(rule.flatAmount) * Number(rule.payoutPercent) / 100);
      const splits = computeSplits(plan, incentivePool, holders).filter((entry) => !userId || entry.userId === userId);
      if (!splits.length) rows.push({ simulated: true, included: false, caseId: item.id, clientName: item.client.fullName, eventType: rule.eventType, reason: "No eligible recipient" });
      for (const split of splits) rows.push({ simulated: true, included: true, caseId: item.id, clientName: item.client.fullName,
        eventType: rule.eventType, planName: plan.name, formula: "PERCENT_OF_MILESTONE_SOURCE", sourceAmount: Number(rule.flatAmount),
        consultantPercent: Number(rule.payoutPercent), incentivePool,
        userId: split.userId, role: split.roleNameSnapshot, splitPercent: Number(split.sharePercentApplied), credit: split.amount });
    }
  }
  const recipientIds = [...new Set(rows.map((row) => row.userId).filter(Boolean))];
  const recipients = recipientIds.length ? await prisma.user.findMany({
    where: { agencyId, id: { in: recipientIds } }, select: { id: true, fullName: true },
  }) : [];
  const recipientNames = new Map(recipients.map((recipient) => [recipient.id, recipient.fullName]));
  const explainedRows = rows.map((row) => ({ ...row, userName: row.userId ? recipientNames.get(row.userId) || "Inactive team member" : null }));
  const personTotals = new Map();
  for (const row of explainedRows.filter((entry) => entry.included)) {
    const current = personTotals.get(row.userId) || { userId: row.userId, fullName: row.userName, totalCents: 0, caseIds: new Set(), resultCount: 0 };
    current.totalCents += cents(row.credit);
    current.caseIds.add(row.caseId);
    current.resultCount += 1;
    personTotals.set(row.userId, current);
  }
  const totalsByPerson = [...personTotals.values()].map((row) => ({
    userId: row.userId, fullName: row.fullName, total: row.totalCents / 100, caseCount: row.caseIds.size, resultCount: row.resultCount,
  })).sort((a, b) => b.total - a.total || a.fullName.localeCompare(b.fullName));
  return { simulated: true, filters: { dateFrom: dateFrom || null, dateTo: dateTo || null, caseType: caseType || null, userId: userId || null, caseId: caseId || null },
    summary: { caseCount: new Set(explainedRows.map((row) => row.caseId)).size,
      eligibleResultCount: explainedRows.filter((row) => row.included).length,
      excludedResultCount: explainedRows.filter((row) => !row.included).length,
      recipientCount: totalsByPerson.length },
    totalsByPerson, rows: explainedRows, total: money(explainedRows.reduce((sum, row) => sum + (row.credit || 0), 0)) };
}

export async function getRevenueContest(agencyId, periodId = null) {
  const period = periodId
    ? await prisma.incentivePeriod.findFirst({ where: { id: periodId, agencyId } })
    : await getOrCreateActiveIncentivePeriod(agencyId);
  if (!period) throw createHttpError(404, "Incentive period not found.", "NOT_FOUND");
  const credits = await prisma.incentiveRevenueCredit.findMany({ where: { agencyId, incentivePeriodId: period.id }, orderBy: { collectedAt: "asc" } });
  const ranking = rankRevenueCredits(credits);
  const contest = await prisma.incentiveContest.findUnique({ where: { incentivePeriodId: period.id } });
  return { period, ranking, winners: contest?.status === "FINALIZED" ? contest.winnerSnapshot : contestWinners(ranking), contest };
}

// db defaults to the module client but accepts a transaction handle so a
// caller (creditCaseInvoiceCollection, the cash/QBO refund completions) can
// post this in the SAME transaction as its ledger credit/reversal rows.
// That's what makes the two durable: if the revenue write fails, the whole
// transaction rolls back — the credit cursor never advances and the ledger
// rows never post — so the invoice looks exactly like it was never observed,
// and the next natural retry (a later balance observation, or the hourly
// reconcilePendingIncentiveCredits sweep) redoes both together instead of
// the ledger credit posting while the contest projection is silently lost.
export async function recordRevenueMovement(agencyId, { caseId, caseInvoiceId, delta, triggerSource, triggerRef, collectedAt = new Date() }, db = prisma) {
  if (!Number.isFinite(Number(delta)) || Number(delta) === 0) return { recorded: false, reason: "no_movement" };
  const invoice = await db.caseInvoice.findFirst({
    where: { id: caseInvoiceId, caseId, agencyId },
    select: { paymentType: true, case: { select: { assignedUserId: true, revenueOwnerId: true } } },
  });
  if (!invoice) return { recorded: false, reason: "invoice_not_found" };
  const category = await db.agencyFeeCategory.findFirst({ where: { agencyId, code: invoice.paymentType, isActive: true } });
  if (!category?.countsTowardRevenue) return { recorded: false, reason: "revenue_category_excluded" };
  let original = null;
  if (Number(delta) < 0) {
    original = await db.incentiveRevenueCredit.findFirst({
      where: { agencyId, caseInvoiceId, netAmount: { gt: 0 } }, orderBy: [{ collectedAt: "asc" }, { id: "asc" }],
    });
    if (!original) return { recorded: false, reason: "original_credit_missing" };
    const reversed = await db.incentiveRevenueCredit.aggregate({
      where: { agencyId, reversesCreditId: original.id }, _sum: { netAmount: true },
    });
    const remaining = Math.max(0, Number(original.netAmount) + Number(reversed._sum.netAmount || 0));
    if (remaining === 0) return { recorded: false, reason: "fully_reversed" };
    delta = -Math.min(Math.abs(Number(delta)), remaining);
  }
  const ownerId = original?.revenueOwnerId || invoice.case.revenueOwnerId || invoice.case.assignedUserId;
  if (!ownerId) return { recorded: false, reason: "revenue_owner_missing" };
  const owner = original ? { id: original.revenueOwnerId, fullName: original.revenueOwnerSnapshot }
    : await db.user.findFirst({ where: { id: ownerId, agencyId, status: "active" }, select: { id: true, fullName: true } });
  if (!owner) return { recorded: false, reason: "revenue_owner_invalid" };
  const period = original
    ? await db.incentivePeriod.findFirst({ where: { id: original.incentivePeriodId, agencyId } })
    : await getOrCreateActiveIncentivePeriod(agencyId, collectedAt, db);
  try {
    const row = await db.incentiveRevenueCredit.create({ data: { agencyId, incentivePeriodId: period.id, caseId, caseInvoiceId,
      revenueOwnerId: owner.id, revenueOwnerSnapshot: owner.fullName, revenueCategory: category.code,
      sourceAmount: Number(delta), netAmount: Number(delta), triggerSource, triggerRef, reversesCreditId: original?.id || null, collectedAt } });
    return { recorded: true, row };
  } catch (error) {
    if (error?.code === "P2002") return { recorded: false, reason: "already_recorded" };
    throw error;
  }
}

export async function finalizeRevenueContest(agencyId, actorUserId, { periodId, prizeType, prizeValue }) {
  if (!["FLAT", "PERCENT_OF_WINNER_REVENUE"].includes(prizeType)) throw createHttpError(400, "Choose a valid contest prize type.", "VALIDATION_ERROR");
  const value = Number(prizeValue);
  if (!(value > 0) || (prizeType === "PERCENT_OF_WINNER_REVENUE" && value > 100)) throw createHttpError(400, "Enter a valid contest prize value.", "VALIDATION_ERROR");
  const view = await getRevenueContest(agencyId, periodId);
  if (view.period.status !== "CLOSED") throw createHttpError(409, "Close the incentive period before finalizing its contest.", "PERIOD_NOT_CLOSED");
  const winners = contestPrizeShares({ prizeType, prizeValue: value, winners: contestWinners(view.ranking) });
  if (!winners.length) throw createHttpError(409, "This period has no eligible revenue.", "NO_ELIGIBLE_REVENUE");
  const result = await prisma.$transaction(async (tx) => {
    const contest = await tx.incentiveContest.create({ data: { agencyId, incentivePeriodId: view.period.id, prizeType, prizeValue: value,
      status: "FINALIZED", rankingSnapshot: view.ranking, winnerSnapshot: winners, finalizedById: actorUserId, finalizedAt: new Date() } });
    await tx.incentiveLedgerEntry.createMany({ data: winners.map((winner) => ({ agencyId, caseId: null, caseInvoiceId: null,
      incentivePlanId: null, userId: winner.userId, attributionKind: "REVENUE_OWNER", roleNameSnapshot: "Monthly Revenue Champion",
      sharePercentApplied: winners.length > 1 ? 100 / winners.length : 100, sourceAmountCollected: winner.netRevenue,
      creditedAmount: winner.prizeAmount, triggerSource: "REVENUE_CONTEST", triggerRef: contest.id, entryType: "CONTEST_PRIZE",
      creditedAt: new Date(), incentivePeriodId: view.period.id, formulaTypeSnapshot: prizeType,
      calculationSnapshot: { prizeValue: value, jointWinnerCount: winners.length, ranking: view.ranking } })) });
    return contest;
  }).catch((error) => { if (error?.code === "P2002") throw createHttpError(409, "This contest has already been finalized.", "CONTEST_ALREADY_FINALIZED"); throw error; });
  await recordActivity({ agencyId, userId: actorUserId, action: "incentive.contest_finalized", details: `${winners.length} winner(s) finalized`,
    entityType: "incentive_contest", entityId: result.id, metadata: { periodId, prizeType, prizeValue: value } });
  return { contest: result, winners };
}
