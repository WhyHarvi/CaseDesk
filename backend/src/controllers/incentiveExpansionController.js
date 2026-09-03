import prisma from "../services/prisma/client.js";
import { closeIncentivePeriod, createReapplicationCycle, finalizeRevenueContest, getOrCreateActiveIncentivePeriod, getRevenueContest, simulateIncentivePlan } from "../services/incentiveExpansionService.js";

export async function getCurrentPeriod(req, res) {
  res.json({ data: await getOrCreateActiveIncentivePeriod(req.auth.agencyId) });
}

export async function closeCurrentPeriod(req, res) {
  res.json({ data: await closeIncentivePeriod(req.auth.agencyId, req.auth.userId, req.body?.reason) });
}

export async function createCycle(req, res) {
  res.status(201).json({ data: await createReapplicationCycle(req.auth.agencyId, req.params.caseId, req.auth.userId, req.body || {}) });
}

export async function simulate(req, res) {
  res.json({ data: await simulateIncentivePlan(req.auth.agencyId, req.body || {}) });
}

export async function contest(req, res) {
  res.json({ data: await getRevenueContest(req.auth.agencyId, req.query.periodId || null) });
}

export async function finalizeContest(req, res) {
  res.status(201).json({ data: await finalizeRevenueContest(req.auth.agencyId, req.auth.userId, req.body || {}) });
}

export async function getBreakdown(req, res) {
  const requested = String(req.query.userId || "").trim();
  const userId = req.auth.role === "admin" && requested ? requested : req.auth.userId;
  const rows = await prisma.incentiveLedgerEntry.findMany({
    where: { agencyId: req.auth.agencyId, userId, ...(req.query.caseId ? { caseId: String(req.query.caseId) } : {}) },
    orderBy: [{ creditedAt: "desc" }, { id: "desc" }], take: 500,
    include: { case: { select: { id: true, caseType: true, client: { select: { id: true, fullName: true } } } },
      caseInvoice: { select: { id: true, invoiceNumber: true, description: true } }, incentivePlan: { select: { id: true, name: true, version: true } },
      reversesEntry: { select: { id: true, creditedAmount: true, triggerRef: true } } },
  });
  const isAdmin = req.auth.role === "admin";
  res.json({ data: rows.map((row) => {
    const result = { ...row,
      planName: row.planNameSnapshot || row.incentivePlan?.name || null,
      planVersion: row.planVersionSnapshot || row.incentivePlan?.version || null,
      formula: row.formulaTypeSnapshot || row.calculationSnapshot?.formulaType || null,
      periodId: row.incentivePeriodId,
      adjustmentOf: row.reversesEntry || null,
    };
    if (!isAdmin && row.entryType === "MILESTONE_CREDIT") {
      result.sourceAmountCollected = null;
      result.sharePercentApplied = null;
      result.formula = null;
      result.formulaTypeSnapshot = null;
      result.calculationSnapshot = {};
    }
    return result;
  }) });
}
