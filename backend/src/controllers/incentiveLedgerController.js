import prisma from "../services/prisma/client.js";
import { estimateInvoicePotentialCredit, resolvePlan, resolveHolders, computeSplits } from "../services/incentiveCreditingService.js";
import { fetchPlanTimelineLegs, projectCaseTimelineLegs, tierMultiplierFor } from "../services/incentiveTimelineService.js";

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

export async function getLedger(req, res) {
  const agencyId = req.auth.agencyId;
  const userId = targetUserId(req);
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 50));

  const where = {
    agencyId,
    ...(userId ? { userId } : {}),
    ...(req.query.caseId ? { caseId: String(req.query.caseId) } : {}),
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
  res.json({ data: rows, meta: { page, pageSize, total } });
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

  const invoices = await prisma.caseInvoice.findMany({
    where: { agencyId, balance: { gt: 0 }, status: { notIn: ["Void", "Voided"] }, case: { archivedAt: null, deletedAt: null } },
    select: { id: true, caseId: true, balance: true, invoiceNumber: true, description: true,
      case: { select: { caseType: true, stage: true, client: { select: { id: true, fullName: true } } } } },
  });
  const byCase = new Map();
  for (const invoice of invoices) {
    const outstandingBalance = Number(invoice.balance);
    const estimate = await estimateInvoicePotentialCredit(agencyId, { caseInvoiceId: invoice.id, outstandingBalance });
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
    select: { id: true, caseType: true, stage: true, client: { select: { id: true, fullName: true } } },
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

  const rows = [];
  for (const caseItem of candidateCases) {
    const resolved = resolvedByCaseType.get(caseItem.caseType);
    if (!resolved) continue;

    // Confirm this user is actually a holder on this case before doing any
    // per-leg work — reuses computeSplits (already-tested attribution
    // logic) with a large nominal pool so a small sharePercent doesn't
    // round to 0 cents and produce a false negative.
    const holders = await resolveHolders(agencyId, caseItem.id);
    const splits = computeSplits(resolved.plan, 10000, holders);
    if (!splits.some((entry) => entry.userId === userId)) continue;

    const projectedLegs = await projectCaseTimelineLegs(agencyId, caseItem.id, resolved.legs);
    const now = new Date();
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
