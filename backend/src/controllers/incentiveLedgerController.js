import prisma from "../services/prisma/client.js";
import { getCasePaymentSummary } from "../services/paymentScheduleService.js";
import { estimatePotentialCredit } from "../services/incentiveCreditingService.js";

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

// In-flight cases the target user is attributed on (holds a case role, or
// owns/converted the lead this case came from), with an estimated payout
// if the outstanding balance were collected right now. Read-only — no
// ledger rows, response explicitly flagged `estimated: true` per row so
// the frontend never confuses this with earned history.
export async function getPipeline(req, res) {
  const agencyId = req.auth.agencyId;
  const userId = targetUserId(req);
  if (!userId) return res.json({ data: [] });

  const [roleCaseIds, leadCaseIds] = await Promise.all([
    prisma.caseRoleAssignment.findMany({ where: { agencyId, userId, status: "active" }, select: { caseId: true } }),
    prisma.lead.findMany({
      where: { agencyId, convertedCaseId: { not: null }, OR: [{ ownerUserId: userId }, { conversion: { convertedById: userId } }] },
      select: { convertedCaseId: true },
    }),
  ]);
  const caseIds = [...new Set([...roleCaseIds.map((row) => row.caseId), ...leadCaseIds.map((row) => row.convertedCaseId)])];
  if (!caseIds.length) return res.json({ data: [] });

  const cases = await prisma.case.findMany({
    where: { id: { in: caseIds }, agencyId, archivedAt: null, deletedAt: null },
    select: { id: true, caseType: true, stage: true, client: { select: { id: true, fullName: true } } },
  });

  const rows = [];
  for (const caseItem of cases) {
    const summary = await getCasePaymentSummary(agencyId, caseItem.id);
    const outstandingBalance = Number(summary.balance || 0);
    if (!(outstandingBalance > 0)) continue;
    const estimate = await estimatePotentialCredit(agencyId, { caseId: caseItem.id, caseType: caseItem.caseType, outstandingBalance });
    if (!estimate) continue;
    const mine = estimate.entries.filter((entry) => entry.userId === userId);
    const myTotal = mine.reduce((sum, entry) => sum + entry.amount, 0);
    if (!(myTotal > 0)) continue;
    rows.push({
      caseId: caseItem.id,
      caseType: caseItem.caseType,
      stage: caseItem.stage,
      client: caseItem.client,
      outstandingBalance,
      planName: estimate.planName,
      estimatedAmount: myTotal,
      estimated: true,
    });
  }
  rows.sort((a, b) => b.estimatedAmount - a.estimatedAmount);
  res.json({ data: rows });
}
