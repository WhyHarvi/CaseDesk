import prisma from "./prisma/client.js";
import { logger } from "./logger.js";
import { getCasePaymentSummary } from "./paymentScheduleService.js";

const planInclude = { roleShares: true, tiers: { orderBy: { minCumulativeAmount: "asc" } } };

async function resolvePlan(agencyId, caseType) {
  const specific = caseType
    ? await prisma.incentivePlan.findFirst({ where: { agencyId, caseType, isActive: true }, include: planInclude })
    : null;
  if (specific) return specific;
  return prisma.incentivePlan.findFirst({ where: { agencyId, caseType: null, isActive: true }, include: planInclude });
}

function tierRateFor(tiers, cumulativeAfterPayment) {
  let rate = null;
  for (const tier of tiers) {
    if (Number(tier.minCumulativeAmount) <= cumulativeAfterPayment) rate = Number(tier.rate);
    else break;
  }
  return rate;
}

async function computePool(plan, { agencyId, caseId, delta }) {
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

async function resolveHolders(agencyId, caseId) {
  const [lead, roleAssignments] = await Promise.all([
    prisma.lead.findFirst({
      where: { convertedCaseId: caseId, agencyId },
      select: { ownerUserId: true, conversion: { select: { convertedById: true } } },
    }),
    prisma.caseRoleAssignment.findMany({
      where: { agencyId, caseId, status: "active" },
      select: { caseRoleId: true, userId: true, caseRole: { select: { name: true } } },
    }),
  ]);
  const byCaseRoleId = new Map();
  for (const row of roleAssignments) {
    const bucket = byCaseRoleId.get(row.caseRoleId) || { name: row.caseRole.name, userIds: [] };
    bucket.userIds.push(row.userId);
    byCaseRoleId.set(row.caseRoleId, bucket);
  }
  return {
    leadOwnerUserId: lead?.ownerUserId || null,
    leadConverterUserId: lead?.conversion?.convertedById || null,
    caseRoleHolders: byCaseRoleId,
  };
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
function computeSplits(plan, pool, holders) {
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
export async function creditCaseInvoiceCollection(agencyId, { caseId, caseInvoiceId, newBalance, trigger }) {
  const newBalanceNumber = Number(newBalance);

  let cursor = await prisma.caseInvoiceCreditCursor.findUnique({ where: { caseInvoiceId } });
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
  if (!(delta > 0)) return { credited: false, reason: "no_new_collection" };

  const caseItem = await prisma.case.findUnique({ where: { id: caseId }, select: { caseType: true } });
  const plan = await resolvePlan(agencyId, caseItem?.caseType || null);
  if (!plan) return { credited: false, reason: "no_active_plan" };

  const pool = await computePool(plan, { agencyId, caseId, delta });
  if (!(pool > 0)) return { credited: false, reason: "zero_pool" };

  const holders = await resolveHolders(agencyId, caseId);
  // No one currently holds any of this plan's attribution points on this
  // case — that share of the pool goes uncredited for this event rather
  // than being redistributed to the remaining shares (see computeSplits).
  const rows = computeSplits(plan, pool, holders).map((entry) => ({
    agencyId,
    caseId,
    caseInvoiceId,
    incentivePlanId: plan.id,
    userId: entry.userId,
    attributionKind: entry.attributionKind,
    caseRoleId: entry.caseRoleId,
    roleNameSnapshot: entry.roleNameSnapshot,
    sharePercentApplied: entry.sharePercentApplied,
    sourceAmountCollected: delta,
    creditedAmount: entry.amount,
    triggerSource: trigger,
    triggerRef: null,
    creditedAt: new Date(),
  }));

  const result = await prisma.$transaction(async (tx) => {
    const claim = await tx.caseInvoiceCreditCursor.updateMany({
      where: { caseInvoiceId, lastCreditedBalance: cursor.lastCreditedBalance },
      data: { lastCreditedBalance: newBalanceNumber },
    });
    if (claim.count !== 1) return { credited: false, reason: "lost_race" };
    if (rows.length) await tx.incentiveLedgerEntry.createMany({ data: rows });
    return { credited: true, entryCount: rows.length };
  });

  if (result.credited) {
    logger.info("incentive.credited", { agencyId, caseId, caseInvoiceId, trigger, delta, entryCount: result.entryCount });
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

// Re-baselines an invoice's cursor to its new balance without crediting
// anything — for balance changes that don't represent real collected
// revenue (currently: voiding an untouched installment invoice back to
// balance 0). Without this, the next time anything observes this invoice
// it would compute a large false "delta" against the stale pre-void
// baseline and credit the whole amount as if it had just been collected.
export async function resetCreditCursor(agencyId, caseInvoiceId, newBalance) {
  await prisma.caseInvoiceCreditCursor.upsert({
    where: { caseInvoiceId },
    create: { agencyId, caseInvoiceId, lastCreditedBalance: Number(newBalance) },
    update: { lastCreditedBalance: Number(newBalance) },
  });
}
