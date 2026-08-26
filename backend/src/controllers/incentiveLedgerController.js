import prisma from "../services/prisma/client.js";
import { estimateInvoicePotentialCreditFromRow, resolvePlan, resolveHoldersBatch, computeSplits } from "../services/incentiveCreditingService.js";
import { fetchPlanTimelineLegs, projectCaseTimelineLegsBatch, tierMultiplierFor } from "../services/incentiveTimelineService.js";

// Incentive figures are personal financial data, not general case
// visibility — admins can look at anyone's, everyone else only ever sees
// their own, full stop (no "assigned vs all" configurability like
// caseAccessWhere; that's about which cases you can open, this is about
// whose earnings you can see).
function targetUserId(req, { defaultToSelf } = { defaultToSelf: true }) {
  if (req.auth.role === "admin") {
    const requested = String(req.query.userId || "").trim();
    if (requested) return requested;
    return defaultToSelf ? req.auth.userId : null;
  }
  return req.auth.userId;
}

function startOfCurrentMonthUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function parseDate(value) {
  if (!value) return undefined;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

const APPROVAL_STATUSES = new Set(["APPROVED", "RECALCULATED", "AUTOMATIC", "REVERSED"]);

function approvalStatusFor(entry) {
  if (entry.entryType === "REVERSAL") return "REVERSED";
  if (entry.entryType === "ADJUSTMENT" || entry.triggerSource === "PLAN_RECALCULATION") return "RECALCULATED";
  if (entry.triggerSource === "RETROACTIVE_APPROVAL") return "APPROVED";
  return "AUTOMATIC";
}

function parseApprovalStatus(value) {
  const status = String(value || "").trim().toUpperCase();
  if (!status || status === "ALL") return null;
  return APPROVAL_STATUSES.has(status) ? status : null;
}

export async function getLedger(req, res) {
  const agencyId = req.auth.agencyId;
  const userId = targetUserId(req);
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 50));

  const approvalStatus = parseApprovalStatus(req.query.approvalStatus);
  const where = {
    agencyId,
    ...(userId ? { userId } : {}),
    ...(req.query.caseId ? { caseId: String(req.query.caseId) } : {}),
    ...(approvalStatus === "APPROVED" ? { triggerSource: "RETROACTIVE_APPROVAL", entryType: "CREDIT" } : {}),
    ...(approvalStatus === "RECALCULATED" ? { entryType: "ADJUSTMENT", triggerSource: "PLAN_RECALCULATION" } : {}),
    ...(approvalStatus === "REVERSED" ? { entryType: "REVERSAL" } : {}),
    ...(approvalStatus === "AUTOMATIC" ? { entryType: { notIn: ["REVERSAL", "ADJUSTMENT"] }, NOT: { triggerSource: "RETROACTIVE_APPROVAL" } } : {}),
  };
  const creditedAt = {};
  const from = parseDate(req.query.dateFrom);
  const to = parseDate(req.query.dateTo);
  if (from) creditedAt.gte = from;
  if (to) creditedAt.lte = to;
  if (Object.keys(creditedAt).length) where.creditedAt = creditedAt;

  const [rows, total] = await Promise.all([
    prisma.incentiveLedgerEntry.findMany({
      where,
      orderBy: { creditedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        user: { select: { id: true, fullName: true } },
        case: { select: { id: true, caseType: true, client: { select: { id: true, fullName: true } } } },
        incentivePlan: { select: { id: true, name: true } },
        timelineLegEvaluation: { select: { legNameSnapshot: true, elapsedMinutes: true, multiplierPercent: true } },
      },
    }),
    prisma.incentiveLedgerEntry.count({ where }),
  ]);
  res.json({
    data: rows.map((row) => ({ ...row, approvalStatus: approvalStatusFor(row) })),
    meta: { page, pageSize, total, approvalStatuses: [...APPROVAL_STATUSES] },
  });
}

export async function getSummary(req, res) {
  const agencyId = req.auth.agencyId;
  const userId = targetUserId(req);
  if (!userId) return res.json({ data: { lifetimeTotal: 0, monthTotal: 0, byRole: [] } });

  const [lifetime, month, byRole] = await Promise.all([
    prisma.incentiveLedgerEntry.aggregate({ where: { agencyId, userId }, _sum: { creditedAmount: true } }),
    prisma.incentiveLedgerEntry.aggregate({ where: { agencyId, userId, creditedAt: { gte: startOfCurrentMonthUtc() } }, _sum: { creditedAmount: true } }),
    prisma.incentiveLedgerEntry.groupBy({ by: ["roleNameSnapshot"], where: { agencyId, userId }, _sum: { creditedAmount: true } }),
  ]);

  res.json({
    data: {
      lifetimeTotal: Number(lifetime._sum.creditedAmount || 0),
      monthTotal: Number(month._sum.creditedAmount || 0),
      byRole: byRole.map((row) => ({ role: row.roleNameSnapshot, total: Number(row._sum.creditedAmount || 0) })).sort((a, b) => b.total - a.total),
    },
  });
}

export async function getTeamSummary(req, res) {
  const agencyId = req.auth.agencyId;
  const [lifetimeByUser, monthByUser, users] = await Promise.all([
    prisma.incentiveLedgerEntry.groupBy({ by: ["userId"], where: { agencyId }, _sum: { creditedAmount: true } }),
    prisma.incentiveLedgerEntry.groupBy({ by: ["userId"], where: { agencyId, creditedAt: { gte: startOfCurrentMonthUtc() } }, _sum: { creditedAmount: true } }),
    prisma.user.findMany({ where: { agencyId, status: "active", role: { in: ["admin", "consultant", "frontdesk"] } }, select: { id: true, fullName: true, role: true } }),
  ]);
  const lifetimeByUserId = new Map(lifetimeByUser.map((row) => [row.userId, Number(row._sum.creditedAmount || 0)]));
  const monthByUserId = new Map(monthByUser.map((row) => [row.userId, Number(row._sum.creditedAmount || 0)]));

  const data = users
    .map((user) => ({ userId: user.id, fullName: user.fullName, role: user.role, lifetimeTotal: lifetimeByUserId.get(user.id) || 0, monthTotal: monthByUserId.get(user.id) || 0 }))
    .sort((a, b) => b.lifetimeTotal - a.lifetimeTotal);
  res.json({ data });
}

// Outstanding invoices use their frozen attribution snapshots, so a case
// transfer cannot silently move an earlier invoice's projected incentive.
export async function getPipeline(req, res) {
  const agencyId = req.auth.agencyId;
  const userId = targetUserId(req);
  if (!userId) return res.json({ data: [] });

  // incentiveSnapshot is fetched here (not via a per-invoice lookup) so the
  // estimate loop below never re-queries a row this call already has —
  // that redundant fetch was the entire per-invoice DB cost for every
  // formula type except TIERED_PERCENT_OF_REVENUE.
  const invoices = await prisma.caseInvoice.findMany({
    where: { agencyId, balance: { gt: 0 }, status: { notIn: ["Void", "Voided"] }, case: { archivedAt: null, deletedAt: null } },
    select: { id: true, caseId: true, balance: true, invoiceNumber: true, description: true, incentiveSnapshot: true,
      case: { select: { caseType: true, stage: true, client: { select: { id: true, fullName: true } } } } },
  });
  const byCase = new Map();
  for (const invoice of invoices) {
    const outstandingBalance = Number(invoice.balance);
    const estimate = await estimateInvoicePotentialCreditFromRow(agencyId, { caseId: invoice.caseId, incentiveSnapshot: invoice.incentiveSnapshot, outstandingBalance });
    if (!estimate) continue;
    const mine = estimate.entries.filter((entry) => entry.userId === userId);
    const myTotal = mine.reduce((sum, entry) => sum + entry.amount, 0);
    if (!(myTotal > 0)) continue;
    const invoiceDetail = {
      caseInvoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      description: invoice.description,
      outstandingBalance,
      planName: estimate.planName,
      formulaType: estimate.formulaType,
      flatAmount: estimate.flatAmount,
      percentRate: estimate.percentRate,
      tiers: estimate.tiers,
      matchedRate: estimate.matchedRate,
      myShares: mine.map((entry) => ({ roleNameSnapshot: entry.roleNameSnapshot, attributionKind: entry.attributionKind, sharePercentApplied: entry.sharePercentApplied, amount: entry.amount })),
      myAmount: myTotal,
    };
    const existing = byCase.get(invoice.caseId);
    if (existing) {
      existing.outstandingBalance += outstandingBalance;
      existing.estimatedAmount += myTotal;
      existing.invoices.push(invoiceDetail);
      continue;
    }
    byCase.set(invoice.caseId, { caseId: invoice.caseId, caseType: invoice.case.caseType, stage: invoice.case.stage,
      client: invoice.case.client, outstandingBalance, planName: estimate.planName, estimatedAmount: myTotal, estimated: true,
      invoices: [invoiceDetail] });
  }
  const rows = [...byCase.values()];
  rows.sort((a, b) => b.estimatedAmount - a.estimatedAmount);
  res.json({ data: rows });
}

// "Every in-progress/not-started timeline-bonus leg across cases where I
// could plausibly be credited" — the forward-looking counterpart to the
// Ledger tab's resolved history. Bounded to a "my plausible cases" scan,
// never an agency-wide one: resolveHolders' own attribution sources are
// either case-team membership (assignedUserId / active CaseAssignment /
// active CaseRoleAssignment — mirrors caseAccessWhere's "assigned" scope)
// or lead-derived attribution (LEAD_OWNER/LEAD_CONVERTER), which isn't
// case-team-gated at all, so both have to be unioned into the candidate set
// before any per-case work happens.
export async function getActiveTimelines(req, res) {
  const agencyId = req.auth.agencyId;
  const userId = targetUserId(req);
  if (!userId) return res.json({ data: [] });

  const [ownedLeadCases, convertedLeadCases] = await Promise.all([
    prisma.lead.findMany({ where: { agencyId, ownerUserId: userId, convertedCaseId: { not: null } }, select: { convertedCaseId: true } }),
    prisma.leadConversion.findMany({ where: { agencyId, convertedById: userId, caseId: { not: null } }, select: { caseId: true } }),
  ]);
  const leadDerivedCaseIds = [...new Set([...ownedLeadCases.map((row) => row.convertedCaseId), ...convertedLeadCases.map((row) => row.caseId)])];

  const candidateCases = await prisma.case.findMany({
    where: {
      agencyId,
      archivedAt: null,
      deletedAt: null,
      OR: [
        { assignedUserId: userId },
        { assignments: { some: { consultantUserId: userId, status: "active" } } },
        { roleAssignments: { some: { userId, status: "active" } } },
        ...(leadDerivedCaseIds.length ? [{ id: { in: leadDerivedCaseIds } }] : []),
      ],
    },
    select: {
      id: true, caseType: true, stage: true, client: { select: { id: true, fullName: true } },
      // Feeds resolveHoldersBatch directly — the same fields resolveHolders
      // would otherwise re-fetch with its own query, once per case.
      assignedUserId: true,
      assignments: { where: { status: "active" }, select: { consultantUserId: true } },
    },
  });
  if (!candidateCases.length) return res.json({ data: [] });

  // Cheapest filter first: resolve each distinct caseType's plan+legs once
  // (a small, bounded set) before touching any per-case data.
  const resolvedByCaseType = new Map();
  const legsByPlanId = new Map();
  for (const caseType of new Set(candidateCases.map((row) => row.caseType))) {
    const plan = await resolvePlan(agencyId, caseType);
    if (!plan) continue;
    if (!legsByPlanId.has(plan.id)) legsByPlanId.set(plan.id, await fetchPlanTimelineLegs(plan.id));
    const legs = legsByPlanId.get(plan.id);
    if (legs.length) resolvedByCaseType.set(caseType, { plan, legs });
  }

  // Only cases whose type actually has a plan+legs need holders/projections
  // resolved at all — and now that's done once, batched across this whole
  // set, instead of two extra round trips per case (what made this endpoint
  // take ~6s for a full caseload; see the perf investigation this replaces).
  const eligibleCases = candidateCases.filter((row) => resolvedByCaseType.has(row.caseType));
  if (!eligibleCases.length) return res.json({ data: [] });

  const holdersByCaseId = await resolveHoldersBatch(agencyId, eligibleCases);
  const projectedLegsByCaseId = await projectCaseTimelineLegsBatch(
    agencyId,
    eligibleCases.map((row) => ({ caseId: row.id, legs: resolvedByCaseType.get(row.caseType).legs })),
  );

  const rows = [];
  const now = new Date();
  for (const caseItem of eligibleCases) {
    const resolved = resolvedByCaseType.get(caseItem.caseType);
    const holders = holdersByCaseId.get(caseItem.id);

    // Confirm this user is actually a holder on this case before doing any
    // per-leg work — reuses computeSplits (already-tested attribution
    // logic) with a large nominal pool so a small sharePercent doesn't
    // round to 0 cents and produce a false negative.
    const splits = computeSplits(resolved.plan, 10000, holders);
    if (!splits.some((entry) => entry.userId === userId)) continue;

    const projectedLegs = projectedLegsByCaseId.get(caseItem.id) || [];
    for (const leg of projectedLegs) {
      if (leg.state !== "IN_PROGRESS") continue;
      const elapsedDays = (now.getTime() - new Date(leg.fromCheckpointAt).getTime()) / 86_400_000;
      const match = tierMultiplierFor(leg.tiers, elapsedDays);
      if (!match) continue;
      const pool = (leg.baseBonusAmount * match.multiplierPercent) / 100;
      const mySplit = computeSplits(resolved.plan, pool, holders).find((entry) => entry.userId === userId);
      if (!mySplit) continue;
      leg.currentTierId = match.tierId;
      leg.currentMultiplierPercent = match.multiplierPercent;
      leg.potentialAmount = mySplit.amount;
      leg.mySharePercent = mySplit.sharePercentApplied;
      leg.myRoleName = mySplit.roleNameSnapshot;
    }
    const legs = projectedLegs.filter((leg) => leg.state !== "RESOLVED");
    if (!legs.length) continue;
    rows.push({ caseId: caseItem.id, caseType: caseItem.caseType, stage: caseItem.stage, client: caseItem.client, legs });
  }
  res.json({ data: rows });
}
