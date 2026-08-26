import prisma from "./prisma/client.js";
import { logger } from "./logger.js";
import { getCasePaymentSummary } from "./paymentScheduleService.js";
import { evaluateCaseTimelineLegs } from "./incentiveTimelineService.js";

const planInclude = { roleShares: true, tiers: { orderBy: { minCumulativeAmount: "asc" } } };

export async function resolvePlan(agencyId, caseType) {
  const specific = caseType
    ? await prisma.incentivePlan.findFirst({ where: { agencyId, caseType, isActive: true }, include: planInclude })
    : null;
  if (specific) return specific;
  return prisma.incentivePlan.findFirst({ where: { agencyId, caseType: null, isActive: true }, include: planInclude });
}

export function tierRateFor(tiers, cumulativeAfterPayment) {
  let rate = null;
  for (const tier of tiers) {
    if (Number(tier.minCumulativeAmount) <= cumulativeAfterPayment) rate = Number(tier.rate);
    else break;
  }
  return rate;
}

export async function computePool(plan, { agencyId, caseId, delta }) {
  if (plan.formulaType === "FLAT_PER_PAYMENT") return Number(plan.flatAmount);
  if (plan.formulaType === "PERCENT_OF_PAYMENT") return (delta * Number(plan.percentRate)) / 100;
  // TIERED_PERCENT_OF_REVENUE — the rate depends on the case's cumulative
  // collected revenue AFTER this payment. Read fresh rather than inside the
  // crediting transaction: the invoice balance this delta was computed from
  // is already committed by the caller before this engine runs, so this is
  // a consistent read regardless of transaction boundaries.
  const summary = await getCasePaymentSummary(agencyId, caseId);
  const cumulativeAfterPayment = Number(summary.paidAmount);
  const rate = tierRateFor(plan.tiers, cumulativeAfterPayment);
  // No tier matches (e.g. every tier starts above the current cumulative
  // total, which shouldn't happen if a 0-floor tier exists, but the plan
  // editor doesn't strictly require one) — nothing is credited for this
  // event rather than guessing a rate.
  if (rate === null) return 0;
  return (delta * rate) / 100;
}

export async function resolveHolders(agencyId, caseId) {
  const [lead, caseTeam, roleAssignments, caseRoleAssignments] = await Promise.all([
    prisma.lead.findFirst({
      where: { convertedCaseId: caseId, agencyId },
      select: { ownerUserId: true, conversion: { select: { convertedById: true } } },
    }),
    prisma.case.findFirst({
      where: { id: caseId, agencyId },
      select: {
        assignedUserId: true,
        assignments: { where: { status: "active" }, select: { consultantUserId: true } },
      },
    }),
    prisma.teamIncentiveRoleAssignment.findMany({
      where: {
        agencyId,
        user: { status: "active", memberships: { some: { agencyId, isActive: true } } },
      },
      select: { caseRoleId: true, userId: true, caseRole: { select: { name: true } } },
    }),
    // The per-case overlay (CaseRolesOverlay.jsx) — who's actually the RCIC
    // etc. on THIS case, not just who's a member of the case team. Already
    // case-scoped by its own caseId column, so no case-team intersection.
    prisma.caseRoleAssignment.findMany({
      where: {
        agencyId,
        caseId,
        status: "active",
        user: { status: "active", memberships: { some: { agencyId, isActive: true } } },
      },
      select: { caseRoleId: true, userId: true, caseRole: { select: { name: true } } },
    }),
  ]);
  const caseTeamUserIds = new Set([
    caseTeam?.assignedUserId,
    ...(caseTeam?.assignments || []).map((assignment) => assignment.consultantUserId),
  ].filter(Boolean));

  const globalByCaseRoleId = new Map();
  for (const row of roleAssignments) {
    if (!caseTeamUserIds.has(row.userId)) continue;
    const bucket = globalByCaseRoleId.get(row.caseRoleId) || { name: row.caseRole.name, userIds: [] };
    if (!bucket.userIds.includes(row.userId)) bucket.userIds.push(row.userId);
    globalByCaseRoleId.set(row.caseRoleId, bucket);
  }

  const overlayByCaseRoleId = new Map();
  for (const row of caseRoleAssignments) {
    const bucket = overlayByCaseRoleId.get(row.caseRoleId) || { name: row.caseRole.name, userIds: [] };
    if (!bucket.userIds.includes(row.userId)) bucket.userIds.push(row.userId);
    overlayByCaseRoleId.set(row.caseRoleId, bucket);
  }

  // Resolved per role, independently: the per-case overlay wins whenever it
  // has any holder for that role, otherwise fall back to the global
  // Team-Members-intersected-with-case-team result. Never merges the two for
  // the same role — an explicit per-case assignment fully overrides the
  // global default rather than adding to it.
  const byCaseRoleId = new Map();
  for (const caseRoleId of new Set([...globalByCaseRoleId.keys(), ...overlayByCaseRoleId.keys()])) {
    const overlay = overlayByCaseRoleId.get(caseRoleId);
    byCaseRoleId.set(caseRoleId, overlay?.userIds.length ? overlay : globalByCaseRoleId.get(caseRoleId));
  }

  return {
    leadOwnerUserId: lead?.ownerUserId || null,
    leadConverterUserId: lead?.conversion?.convertedById || null,
    caseRoleHolders: byCaseRoleId,
  };
}

// Same result as calling resolveHolders() once per case, but as a handful
// of bulk queries instead of one round trip per case — teamIncentiveRoleAssignment
// especially, since it's agency-wide, not case-scoped, and was being
// re-fetched identically for every single case. Built for list endpoints
// (getActiveTimelines, getPipeline) that resolve holders for many cases in
// one request; resolveHolders itself is untouched for the single-case call
// sites (retroactive approval, plan recalculation, required-team checks).
export async function resolveHoldersBatch(agencyId, cases) {
  const caseIds = cases.map((row) => row.id);
  const [leads, roleAssignments, caseRoleAssignments] = await Promise.all([
    prisma.lead.findMany({
      where: { convertedCaseId: { in: caseIds }, agencyId },
      select: { convertedCaseId: true, ownerUserId: true, conversion: { select: { convertedById: true } } },
    }),
    prisma.teamIncentiveRoleAssignment.findMany({
      where: { agencyId, user: { status: "active", memberships: { some: { agencyId, isActive: true } } } },
      select: { caseRoleId: true, userId: true, caseRole: { select: { name: true } } },
    }),
    prisma.caseRoleAssignment.findMany({
      where: { agencyId, caseId: { in: caseIds }, status: "active", user: { status: "active", memberships: { some: { agencyId, isActive: true } } } },
      select: { caseId: true, caseRoleId: true, userId: true, caseRole: { select: { name: true } } },
    }),
  ]);
  const leadByCaseId = new Map(leads.map((lead) => [lead.convertedCaseId, lead]));
  const caseRoleAssignmentsByCaseId = new Map();
  for (const row of caseRoleAssignments) {
    const bucket = caseRoleAssignmentsByCaseId.get(row.caseId) || [];
    bucket.push(row);
    caseRoleAssignmentsByCaseId.set(row.caseId, bucket);
  }

  const holdersByCaseId = new Map();
  for (const caseItem of cases) {
    const caseTeamUserIds = new Set([
      caseItem.assignedUserId,
      ...(caseItem.assignments || []).map((assignment) => assignment.consultantUserId),
    ].filter(Boolean));

    const globalByCaseRoleId = new Map();
    for (const row of roleAssignments) {
      if (!caseTeamUserIds.has(row.userId)) continue;
      const bucket = globalByCaseRoleId.get(row.caseRoleId) || { name: row.caseRole.name, userIds: [] };
      if (!bucket.userIds.includes(row.userId)) bucket.userIds.push(row.userId);
      globalByCaseRoleId.set(row.caseRoleId, bucket);
    }

    const overlayByCaseRoleId = new Map();
    for (const row of caseRoleAssignmentsByCaseId.get(caseItem.id) || []) {
      const bucket = overlayByCaseRoleId.get(row.caseRoleId) || { name: row.caseRole.name, userIds: [] };
      if (!bucket.userIds.includes(row.userId)) bucket.userIds.push(row.userId);
      overlayByCaseRoleId.set(row.caseRoleId, bucket);
    }

    const byCaseRoleId = new Map();
    for (const caseRoleId of new Set([...globalByCaseRoleId.keys(), ...overlayByCaseRoleId.keys()])) {
      const overlay = overlayByCaseRoleId.get(caseRoleId);
      byCaseRoleId.set(caseRoleId, overlay?.userIds.length ? overlay : globalByCaseRoleId.get(caseRoleId));
    }

    const lead = leadByCaseId.get(caseItem.id);
    holdersByCaseId.set(caseItem.id, {
      leadOwnerUserId: lead?.ownerUserId || null,
      leadConverterUserId: lead?.conversion?.convertedById || null,
      caseRoleHolders: byCaseRoleId,
    });
  }
  return holdersByCaseId;
}

function snapshotRecipients(plan, holders) {
  return plan.roleShares.map((share) => {
    let userIds = [];
    let roleName = "Case role";
    if (share.attributionKind === "LEAD_OWNER") {
      roleName = "Lead owner";
      if (holders.leadOwnerUserId) userIds = [holders.leadOwnerUserId];
    } else if (share.attributionKind === "LEAD_CONVERTER") {
      roleName = "Lead converter";
      if (holders.leadConverterUserId) userIds = [holders.leadConverterUserId];
    } else if (share.attributionKind === "PAYMENT_PROCESSOR") {
      // The processor is not known when an invoice is created. Freeze the
      // formula share now and resolve its recipient from the authenticated
      // payment event when money is actually collected.
      roleName = "Payment processor";
    } else {
      const bucket = holders.caseRoleHolders.get(share.caseRoleId);
      roleName = bucket?.name || roleName;
      userIds = bucket?.userIds || [];
    }
    return {
      attributionKind: share.attributionKind,
      caseRoleId: share.caseRoleId,
      roleName,
      sharePercent: Number(share.sharePercent),
      userIds: [...new Set(userIds)],
    };
  });
}

// Called before an invoice is persisted. With no active formula there is no
// incentive state to store. The activation timestamp check prevents a later
// activation from silently reaching backward into older invoices; applying a
// plan to legacy invoices remains an explicit, audited admin action.
export async function buildInvoiceIncentiveSnapshot(agencyId, caseId, caseType, invoiceCreatedAt = new Date()) {
  const plan = await resolvePlan(agencyId, caseType || null);
  if (!plan) return null;
  if (plan.activatedAt && new Date(invoiceCreatedAt) < plan.activatedAt) return null;
  return buildSnapshotForResolvedPlan(agencyId, caseId, plan);
}

async function buildSnapshotForResolvedPlan(agencyId, caseId, plan) {
  const holders = await resolveHolders(agencyId, caseId);
  return {
    agencyId,
    incentivePlanId: plan.id,
    planName: plan.name,
    planVersion: plan.version,
    formulaType: plan.formulaType,
    flatAmount: plan.flatAmount,
    percentRate: plan.percentRate,
    tiers: plan.tiers.map((tier) => ({ minCumulativeAmount: Number(tier.minCumulativeAmount), rate: Number(tier.rate) })),
    recipients: snapshotRecipients(plan, holders),
  };
}

export async function buildInvoiceIncentiveSnapshotForPlan(agencyId, caseId, incentivePlanId) {
  const plan = await prisma.incentivePlan.findFirst({
    where: { id: incentivePlanId, agencyId, isActive: true },
    include: planInclude,
  });
  if (!plan) return null;
  return buildSnapshotForResolvedPlan(agencyId, caseId, plan);
}

// Splits one share's dollar amount evenly across its holders using
// largest-remainder rounding, so the holders' credited cents always sum to
// exactly round(shareAmount * 100) — no cent ever silently vanishes or
// duplicates because of naive per-holder rounding.
function splitEvenly(shareAmountCents, userIds) {
  const base = Math.floor(shareAmountCents / userIds.length);
  let remainder = shareAmountCents - base * userIds.length;
  return [...userIds].sort().map((userId) => {
    const extra = remainder > 0 ? 1 : 0;
    if (remainder > 0) remainder -= 1;
    return { userId, cents: base + extra };
  });
}

// Shared by the real crediting path and the read-only pipeline estimate:
// given a resolved plan, a dollar pool, and who currently holds each
// attribution point, returns one entry per (user, share) with a positive
// amount. A share with no current holder contributes nothing and isn't
// redistributed (see the crediting-engine docs on this tradeoff).
export function computeSplits(plan, pool, holders) {
  const poolCents = Math.round(pool * 100);
  const entries = [];
  for (const share of plan.roleShares) {
    const shareCents = Math.round((poolCents * Number(share.sharePercent)) / 100);
    if (shareCents <= 0) continue;
    let userIds = [];
    let roleNameSnapshot = "";
    if (share.attributionKind === "LEAD_OWNER") {
      roleNameSnapshot = "Lead owner";
      if (holders.leadOwnerUserId) userIds = [holders.leadOwnerUserId];
    } else if (share.attributionKind === "LEAD_CONVERTER") {
      roleNameSnapshot = "Lead converter";
      if (holders.leadConverterUserId) userIds = [holders.leadConverterUserId];
    } else if (share.attributionKind === "PAYMENT_PROCESSOR") {
      roleNameSnapshot = "Payment processor";
      if (holders.paymentProcessorUserId) userIds = [holders.paymentProcessorUserId];
    } else {
      const bucket = holders.caseRoleHolders.get(share.caseRoleId);
      roleNameSnapshot = bucket?.name || "Case role";
      if (bucket?.userIds.length) userIds = bucket.userIds;
    }
    if (!userIds.length) continue;
    for (const split of splitEvenly(shareCents, userIds)) {
      if (split.cents <= 0) continue;
      entries.push({
        userId: split.userId,
        attributionKind: share.attributionKind,
        caseRoleId: share.caseRoleId,
        roleNameSnapshot,
        sharePercentApplied: share.sharePercent,
        amount: split.cents / 100,
      });
    }
  }
  return entries;
}

function computeSnapshotSplits(snapshot, pool, { paymentProcessorUserId = null } = {}) {
  const poolCents = Math.round(pool * 100);
  const entries = [];
  for (const share of Array.isArray(snapshot.recipients) ? snapshot.recipients : []) {
    const shareCents = Math.round((poolCents * Number(share.sharePercent)) / 100);
    const userIds = share.attributionKind === "PAYMENT_PROCESSOR"
      ? [paymentProcessorUserId].filter(Boolean)
      : (Array.isArray(share.userIds) ? share.userIds : []);
    if (shareCents <= 0 || !userIds.length) continue;
    for (const split of splitEvenly(shareCents, userIds)) {
      if (split.cents <= 0) continue;
      entries.push({
        userId: split.userId,
        attributionKind: share.attributionKind,
        caseRoleId: share.caseRoleId || null,
        roleNameSnapshot: share.roleName || "Case role",
        sharePercentApplied: share.sharePercent,
        amount: split.cents / 100,
      });
    }
  }
  return entries;
}

async function computeSnapshotPool(snapshot, { agencyId, caseId, delta }) {
  if (snapshot.formulaType === "FLAT_PER_PAYMENT") {
    return { pool: Number(snapshot.flatAmount), matchedRate: null };
  }
  if (snapshot.formulaType === "PERCENT_OF_PAYMENT") {
    return { pool: (delta * Number(snapshot.percentRate)) / 100, matchedRate: Number(snapshot.percentRate) };
  }
  if (snapshot.formulaType !== "TIERED_PERCENT_OF_REVENUE") return { pool: 0, matchedRate: null };
  const summary = await getCasePaymentSummary(agencyId, caseId);
  const rate = tierRateFor(Array.isArray(snapshot.tiers) ? snapshot.tiers : [], Number(summary.paidAmount));
  return { pool: rate === null ? 0 : (delta * rate) / 100, matchedRate: rate };
}

async function reverseInvoiceCredits(tx, { agencyId, caseId, caseInvoiceId, refundAmount, trigger, newBalance }) {
  const credits = await tx.incentiveLedgerEntry.findMany({
    where: { agencyId, caseId, caseInvoiceId, entryType: "CREDIT", creditedAmount: { gt: 0 } },
    include: { reversalEntries: { select: { creditedAmount: true } } },
    orderBy: [{ creditedAt: "desc" }, { id: "desc" }],
  });
  let remainingSource = refundAmount;
  const rows = [];
  const batches = new Map();
  for (const credit of credits) {
    const key = `${credit.creditedAt.toISOString()}:${Number(credit.sourceAmountCollected)}`;
    const batch = batches.get(key) || { sourceAmount: Number(credit.sourceAmountCollected), credits: [] };
    batch.credits.push(credit);
    batches.set(key, batch);
  }
  for (const batch of batches.values()) {
    if (!(remainingSource > 0)) break;
    const sourceToReverse = Math.min(remainingSource, batch.sourceAmount);
    const ratio = sourceToReverse / batch.sourceAmount;
    for (const credit of batch.credits) {
      const alreadyReversed = credit.reversalEntries.reduce((sum, row) => sum + Math.abs(Number(row.creditedAmount)), 0);
      const available = Math.max(0, Number(credit.creditedAmount) - alreadyReversed);
      const amount = Math.min(available, Math.round(Number(credit.creditedAmount) * ratio * 100) / 100);
      if (!(amount > 0)) continue;
      rows.push({
        agencyId, caseId, caseInvoiceId, incentivePlanId: credit.incentivePlanId, userId: credit.userId,
        attributionKind: credit.attributionKind, caseRoleId: credit.caseRoleId,
        roleNameSnapshot: credit.roleNameSnapshot, sharePercentApplied: credit.sharePercentApplied,
        sourceAmountCollected: -sourceToReverse, creditedAmount: -amount, triggerSource: trigger,
        triggerRef: `balance:${Number(newBalance).toFixed(2)}`, entryType: "REVERSAL",
        reversesEntryId: credit.id, creditedAt: new Date(),
      });
    }
    remainingSource -= sourceToReverse;
  }
  if (rows.length) await tx.incentiveLedgerEntry.createMany({ data: rows });
  return rows.length;
}

// Called for genuine collection events only (a payment applied that shrinks
// the balance). Idempotent via a compare-and-swap on
// CaseInvoiceCreditCursor: a caller can invoke this any number of times
// with the invoice's current balance and it will only ever credit the
// genuinely new delta, exactly once, even under concurrent/duplicate calls
// (retried webhooks, a page load racing a payment). Never throws for
// "nothing to do" cases (no active plan, no eligible holders) — only for
// real unexpected errors, which every call site wraps in its own catch so
// a crediting failure can never break the payment it's reacting to.
//
// Do NOT call this for a void/cancellation, even one that also drops the
// balance to 0 — that balance change doesn't represent collected revenue,
// it represents the invoice ceasing to exist as owed money. Doing so would
// compute a large positive "delta" (baseline balance minus zero) and
// credit the invoice's entire amount as if it had all just been paid,
// which is backwards. Use resetCreditCursor for that case instead — it
// re-baselines the cursor to the new balance without crediting anything.
export async function creditCaseInvoiceCollection(agencyId, { caseId, caseInvoiceId, newBalance, trigger, paymentProcessorUserId = null }) {
  const newBalanceNumber = Number(newBalance);
  const invoice = await prisma.caseInvoice.findFirst({
    where: { id: caseInvoiceId, caseId, agencyId },
    select: { id: true, caseId: true, balance: true, createdAt: true, incentiveSnapshot: true, case: { select: { caseType: true } } },
  });
  if (!invoice) return { credited: false, reason: "invoice_not_found" };

  let snapshot = invoice.incentiveSnapshot;
  if (!snapshot) {
    const data = await buildInvoiceIncentiveSnapshot(agencyId, caseId, invoice.case.caseType, invoice.createdAt);
    if (!data) return { credited: false, reason: "no_active_plan" };
    try {
      snapshot = await prisma.caseInvoiceIncentiveSnapshot.create({ data: { ...data, caseInvoiceId } });
    } catch (error) {
      if (error?.code !== "P2002") throw error;
      snapshot = await prisma.caseInvoiceIncentiveSnapshot.findUnique({ where: { caseInvoiceId } });
    }
  }

  let cursor = await prisma.caseInvoiceCreditCursor.findFirst({ where: { caseInvoiceId, agencyId } });
  if (!cursor) {
    try {
      cursor = await prisma.caseInvoiceCreditCursor.create({ data: { agencyId, caseInvoiceId, lastCreditedBalance: newBalanceNumber } });
    } catch (error) {
      if (error?.code !== "P2002") throw error;
      cursor = await prisma.caseInvoiceCreditCursor.findUnique({ where: { caseInvoiceId } });
    }
    // First-ever observation of this invoice establishes the baseline —
    // nothing has been "newly" collected relative to a baseline that was
    // just created, whether this is a brand-new $0-collected invoice or an
    // existing invoice being backfilled outside the migration's bulk seed.
    return { credited: false, reason: "baseline" };
  }

  const delta = Number(cursor.lastCreditedBalance) - newBalanceNumber;
  if (delta === 0) return { credited: false, reason: "no_balance_change" };

  if (delta < 0) {
    return prisma.$transaction(async (tx) => {
      const claim = await tx.caseInvoiceCreditCursor.updateMany({
        where: { caseInvoiceId, agencyId, lastCreditedBalance: cursor.lastCreditedBalance },
        data: { lastCreditedBalance: newBalanceNumber },
      });
      if (claim.count !== 1) return { credited: false, reason: "lost_race" };
      const entryCount = await reverseInvoiceCredits(tx, {
        agencyId, caseId, caseInvoiceId, refundAmount: Math.abs(delta), trigger, newBalance: newBalanceNumber,
      });
      return { credited: false, reversed: true, entryCount };
    });
  }

  // A no-plan snapshot is intentional. Advance the cursor so activating a
  // plan later cannot retroactively pay this collection.
  if (!snapshot?.incentivePlanId) {
    const claim = await prisma.caseInvoiceCreditCursor.updateMany({
      where: { caseInvoiceId, agencyId, lastCreditedBalance: cursor.lastCreditedBalance },
      data: { lastCreditedBalance: newBalanceNumber },
    });
    return { credited: false, reason: "no_plan_at_invoice_creation", claimed: claim.count === 1 };
  }

  let verifiedPaymentProcessorId = null;
  if (paymentProcessorUserId) {
    const processor = await prisma.user.findFirst({
      where: { id: paymentProcessorUserId, agencyId, status: "active", memberships: { some: { agencyId, isActive: true } } },
      select: { id: true },
    });
    verifiedPaymentProcessorId = processor?.id || null;
  }
  const needsPaymentProcessor = Array.isArray(snapshot.recipients)
    && snapshot.recipients.some((share) => share?.attributionKind === "PAYMENT_PROCESSOR");
  if (needsPaymentProcessor && !verifiedPaymentProcessorId) {
    logger.warn("incentive.payment_processor_missing", { agencyId, caseId, caseInvoiceId, trigger });
  }

  const { pool } = await computeSnapshotPool(snapshot, { agencyId, caseId, delta });
  const creditedAt = new Date();
  const rows = computeSnapshotSplits(snapshot, pool, { paymentProcessorUserId: verifiedPaymentProcessorId }).map((entry) => ({
    agencyId,
    caseId,
    caseInvoiceId,
    incentivePlanId: snapshot.incentivePlanId,
    userId: entry.userId,
    attributionKind: entry.attributionKind,
    caseRoleId: entry.caseRoleId,
    roleNameSnapshot: entry.roleNameSnapshot,
    sharePercentApplied: entry.sharePercentApplied,
    sourceAmountCollected: delta,
    creditedAmount: entry.amount,
    triggerSource: trigger,
    triggerRef: `balance:${newBalanceNumber.toFixed(2)}`,
    entryType: "CREDIT",
    creditedAt,
  }));

  const result = await prisma.$transaction(async (tx) => {
    const claim = await tx.caseInvoiceCreditCursor.updateMany({
      where: { caseInvoiceId, agencyId, lastCreditedBalance: cursor.lastCreditedBalance },
      data: { lastCreditedBalance: newBalanceNumber },
    });
    if (claim.count !== 1) return { credited: false, reason: "lost_race" };
    if (rows.length) await tx.incentiveLedgerEntry.createMany({ data: rows });
    return { credited: true, entryCount: rows.length };
  });

  if (result.credited) {
    logger.info("incentive.credited", { agencyId, caseId, caseInvoiceId, trigger, delta, entryCount: result.entryCount });
    // Gives FIRST_PAYMENT_COLLECTED-anchored timeline legs a hook, and a
    // free retry sweep via the existing reconcilePendingIncentiveCredits
    // worker (this function is already called from there).
    await evaluateCaseTimelineLegs(agencyId, caseId).catch((error) => {
      logger.warn("incentive.timeline_bonus_evaluation_failed", { agencyId, caseId, reason: error.message });
    });
  }
  return result;
}

// Read-only "what if this outstanding balance got collected right now"
// estimate for the pipeline view — same plan resolution and split logic as
// the real crediting path, but never touches the cursor or writes a ledger
// row. Returns null if there's no active plan for this case's type (the
// case simply isn't projected). Tiered formulas use the case's cumulative
// collected-to-date as it stands right now, not a projection of what it
// will be after this hypothetical payment — a reasonable approximation for
// a number that's explicitly labeled an estimate, not a promise.
export async function estimatePotentialCredit(agencyId, { caseId, caseType, outstandingBalance }) {
  const balance = Number(outstandingBalance);
  if (!(balance > 0)) return null;
  const plan = await resolvePlan(agencyId, caseType || null);
  if (!plan) return null;
  const pool = await computePool(plan, { agencyId, caseId, delta: balance });
  if (!(pool > 0)) return null;
  const holders = await resolveHolders(agencyId, caseId);
  return { planId: plan.id, planName: plan.name, entries: computeSplits(plan, pool, holders) };
}

export async function estimateInvoicePotentialCredit(agencyId, { caseInvoiceId, outstandingBalance }) {
  const balance = Number(outstandingBalance);
  if (!(balance > 0)) return null;
  const invoice = await prisma.caseInvoice.findFirst({
    where: { id: caseInvoiceId, agencyId },
    select: { caseId: true, incentiveSnapshot: true },
  });
  const snapshot = invoice?.incentiveSnapshot;
  if (!snapshot?.incentivePlanId) return null;
  const { pool, matchedRate } = await computeSnapshotPool(snapshot, { agencyId, caseId: invoice.caseId, delta: balance });
  if (!(pool > 0)) return null;
  return {
    planId: snapshot.incentivePlanId,
    planName: snapshot.planName,
    formulaType: snapshot.formulaType,
    flatAmount: snapshot.flatAmount != null ? Number(snapshot.flatAmount) : null,
    percentRate: snapshot.percentRate != null ? Number(snapshot.percentRate) : null,
    tiers: Array.isArray(snapshot.tiers) ? snapshot.tiers : [],
    matchedRate,
    entries: computeSnapshotSplits(snapshot, pool),
  };
}

// Same as estimateInvoicePotentialCredit, but for a caller (getPipeline)
// that already has caseId/incentiveSnapshot from its own bulk invoice
// query — skips the redundant per-invoice findFirst that was re-fetching
// the exact same row the caller already had in hand. Only
// TIERED_PERCENT_OF_REVENUE still hits the database (via computeSnapshotPool
// -> getCasePaymentSummary); FLAT_PER_PAYMENT/PERCENT_OF_PAYMENT are pure.
export async function estimateInvoicePotentialCreditFromRow(agencyId, { caseId, incentiveSnapshot, outstandingBalance }) {
  const balance = Number(outstandingBalance);
  if (!(balance > 0) || !incentiveSnapshot?.incentivePlanId) return null;
  const { pool, matchedRate } = await computeSnapshotPool(incentiveSnapshot, { agencyId, caseId, delta: balance });
  if (!(pool > 0)) return null;
  return {
    planId: incentiveSnapshot.incentivePlanId,
    planName: incentiveSnapshot.planName,
    formulaType: incentiveSnapshot.formulaType,
    flatAmount: incentiveSnapshot.flatAmount != null ? Number(incentiveSnapshot.flatAmount) : null,
    percentRate: incentiveSnapshot.percentRate != null ? Number(incentiveSnapshot.percentRate) : null,
    tiers: Array.isArray(incentiveSnapshot.tiers) ? incentiveSnapshot.tiers : [],
    matchedRate,
    entries: computeSnapshotSplits(incentiveSnapshot, pool),
  };
}

// Re-baselines an invoice's cursor to its new balance without crediting
// anything — for balance changes that don't represent real collected
// revenue (currently: voiding an untouched installment invoice back to
// balance 0). Without this, the next time anything observes this invoice
// it would compute a large false "delta" against the stale pre-void
// baseline and credit the whole amount as if it had just been collected.
export async function resetCreditCursor(agencyId, caseInvoiceId, newBalance) {
  const invoice = await prisma.caseInvoice.findFirst({
    where: { id: caseInvoiceId, agencyId, incentiveSnapshot: { is: { incentivePlanId: { not: null } } } },
    select: { id: true },
  });
  if (!invoice) return false;
  await prisma.caseInvoiceCreditCursor.upsert({
    where: { caseInvoiceId },
    create: { agencyId, caseInvoiceId, lastCreditedBalance: Number(newBalance) },
    update: { lastCreditedBalance: Number(newBalance) },
  });
  return true;
}

// Re-freezes the incentive snapshots of a case's open, never-credited
// invoices with the CURRENT holders. Used when a case's required team
// (RCIC/Case Worker) is first assigned or changed AFTER its invoices were
// created — an invoice created before the team existed froze with empty
// role shares, so its future collections would never credit the people who
// actually own the case (the "RCIC isn't getting his check" gap). Only
// invoices that still carry a balance and have never had a credit are
// touched, so already-collected money is never re-attributed — "only
// future collections qualify", the same rule applyPlanToLegacyInvoices
// uses. Best-effort at every call site: a failure here must never break
// the team assignment it's reacting to.
export async function refreshOpenInvoiceSnapshots(agencyId, caseId, db = prisma) {
  const invoices = await db.caseInvoice.findMany({
    where: {
      agencyId,
      caseId,
      balance: { gt: 0 },
      status: { notIn: ["Void", "Voided"] },
      incentiveLedgerEntries: { none: {} },
    },
    select: { id: true, case: { select: { caseType: true } } },
  });
  let refreshed = 0;
  for (const invoice of invoices) {
    const snapshot = await buildInvoiceIncentiveSnapshot(agencyId, caseId, invoice.case.caseType);
    if (!snapshot?.incentivePlanId) continue;
    await db.caseInvoiceIncentiveSnapshot.upsert({
      where: { caseInvoiceId: invoice.id },
      create: { ...snapshot, caseInvoiceId: invoice.id },
      update: snapshot,
    });
    refreshed += 1;
  }
  return refreshed;
}

let retryTimer = null;

export async function backfillMissingInvoiceSnapshots(limit = 100) {
  const activePlans = await prisma.incentivePlan.findMany({
    where: { isActive: true },
    select: { agencyId: true, caseType: true },
  });
  if (!activePlans.length) return 0;
  const eligibleScopes = activePlans.map((plan) => plan.caseType
    ? { agencyId: plan.agencyId, case: { caseType: plan.caseType } }
    : { agencyId: plan.agencyId });
  const invoices = await prisma.caseInvoice.findMany({
    where: { incentiveSnapshot: null, OR: eligibleScopes },
    take: limit,
    orderBy: { createdAt: "asc" },
    select: { id: true, agencyId: true, caseId: true, createdAt: true, case: { select: { caseType: true } } },
  });
  for (const invoice of invoices) {
    const data = await buildInvoiceIncentiveSnapshot(invoice.agencyId, invoice.caseId, invoice.case.caseType, invoice.createdAt);
    // A workspace may have only case-type-specific active plans. Keep this
    // guard even after the scope filter above so a concurrent deactivation
    // cannot rebuild testing-era state between the list and create queries.
    if (!data?.incentivePlanId) continue;
    await prisma.caseInvoiceIncentiveSnapshot.create({ data: { ...data, caseInvoiceId: invoice.id } }).catch((error) => {
      if (error?.code !== "P2002") throw error;
    });
  }
  return invoices.length;
}

export async function reconcilePendingIncentiveCredits() {
  await backfillMissingInvoiceSnapshots();
  const rows = await prisma.$queryRaw`
    SELECT i."agency_id" AS "agencyId", i."case_id" AS "caseId", i."id" AS "caseInvoiceId",
           i."balance", i."status"
    FROM "case_invoices" i
    JOIN "case_invoice_credit_cursors" c ON c."case_invoice_id" = i."id"
    WHERE c."last_credited_balance" <> i."balance"
    ORDER BY i."updated_at" ASC
    LIMIT 100
  `;
  for (const row of rows) {
    const operation = ["Void", "Voided"].includes(row.status)
      ? resetCreditCursor(row.agencyId, row.caseInvoiceId, row.balance)
      : creditCaseInvoiceCollection(row.agencyId, {
          caseId: row.caseId, caseInvoiceId: row.caseInvoiceId, newBalance: row.balance, trigger: "RETRY_WORKER",
        });
    await operation.catch((error) => logger.warn("incentive.retry_failed", { caseInvoiceId: row.caseInvoiceId, reason: error.message }));
  }
  return rows.length;
}

export function startIncentiveRetryWorker() {
  if (retryTimer) return;
  const run = () => void reconcilePendingIncentiveCredits().catch((error) => logger.warn("incentive.retry_sweep_failed", { reason: error.message }));
  run();
  retryTimer = setInterval(run, 60_000);
  retryTimer.unref?.();
}

export function stopIncentiveRetryWorker() {
  if (retryTimer) clearInterval(retryTimer);
  retryTimer = null;
}
