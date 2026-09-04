import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

// Problem: an invoice paid in installments produces one positive
// IncentiveRevenueCredit row per collection. The old reversal logic only
// ever looked at the single OLDEST positive credit via findFirst — once
// that one was fully reversed by an earlier refund, a later refund on the
// same invoice found "remaining: 0" on it and returned fully_reversed,
// even though a second (or third) collection's credit sat completely
// untouched. It also re-checked the CURRENT AgencyFeeCategory config
// before reversing, so a later category change could block a historically
// valid reversal. Both silently left contest revenue too high with no
// error anywhere.
test("a refund walks every original collection on an invoice, oldest first, instead of giving up once the first one is exhausted", async () => {
  const expansionService = await source("../src/services/incentiveExpansionService.js");

  const mainStart = expansionService.indexOf("export async function recordRevenueMovement(");
  const mainEnd = expansionService.indexOf("\n// A refund", mainStart);
  const mainBody = expansionService.slice(mainStart, mainEnd);

  // The reversal branch now delegates to a dedicated helper instead of
  // handling a single findFirst() credit inline.
  assert.match(mainBody, /if \(Number\(delta\) < 0\) \{\s*\n\s*return reverseRevenueCredits\(db, agencyId, \{ caseId, caseInvoiceId, refundAmount: Math\.abs\(Number\(delta\)\), triggerSource, triggerRef, collectedAt \}\);/);

  // The original (positive) collection path is untouched: it still checks
  // the CURRENT AgencyFeeCategory — that config only needs to be right at
  // the moment revenue is first recorded, not re-validated later.
  assert.match(mainBody, /const category = await db\.agencyFeeCategory\.findFirst\(\{ where: \{ agencyId, code: invoice\.paymentType, isActive: true \} \}\);\s*\n\s*if \(!category\?\.countsTowardRevenue\) return \{ recorded: false, reason: "revenue_category_excluded" \};/);
  assert.match(mainBody, /reversesCreditId: null, collectedAt \} \}\);/);

  const helperStart = expansionService.indexOf("async function reverseRevenueCredits(");
  const helperBody = expansionService.slice(helperStart, expansionService.indexOf("\n  return { recorded: true, rows };", helperStart));

  // Every positive credit on the invoice is fetched, oldest first — not
  // just the single oldest one.
  assert.match(helperBody, /const originals = await db\.incentiveRevenueCredit\.findMany\(\{\s*\n\s*where: \{ agencyId, caseInvoiceId, netAmount: \{ gt: 0 \} \},\s*\n\s*orderBy: \[\{ collectedAt: "asc" \}, \{ id: "asc" \}\],\s*\n\s*\}\);/);
  assert.doesNotMatch(helperBody, /\.findFirst\(/, "must scan every original credit, not just the first one");

  // Already-reversed amounts are summed per original credit in one query,
  // not re-derived from current config.
  assert.match(helperBody, /const reversedSums = await db\.incentiveRevenueCredit\.groupBy\(\{/);
  assert.match(helperBody, /by: \["reversesCreditId"\],/);

  // The allocation loop walks originals in order, taking whatever each one
  // still has available, until the refund amount is used up — the actual
  // proportional-across-multiple-collections fix.
  assert.match(helperBody, /for \(const original of originals\) \{\s*\n\s*if \(remaining <= 0\) break;\s*\n\s*const available = Math\.max\(0, Number\(original\.netAmount\) - \(alreadyReversedById\.get\(original\.id\) \|\| 0\)\);\s*\n\s*if \(available <= 0\) continue;\s*\n\s*const amount = Math\.min\(available, remaining\);\s*\n\s*remaining -= amount;\s*\n\s*plan\.push\(\{ original, amount \}\);\s*\n\s*\}/);
  assert.match(helperBody, /if \(!plan\.length\) return \{ recorded: false, reason: "fully_reversed" \};/);

  // Each reversal row reuses ITS OWN original credit's snapshotted period,
  // owner, and category — never re-derived from current config — so a
  // later AgencyFeeCategory or case-ownership change can't block a
  // historically valid reversal.
  assert.match(helperBody, /incentivePeriodId: original\.incentivePeriodId, caseId, caseInvoiceId,\s*\n\s*revenueOwnerId: original\.revenueOwnerId, revenueOwnerSnapshot: original\.revenueOwnerSnapshot,\s*\n\s*revenueCategory: original\.revenueCategory,/);
  assert.doesNotMatch(helperBody, /agencyFeeCategory/, "the reversal path must never re-look-up the current fee category");

  // Each reversal row is keyed by triggerRef + which original it reverses,
  // not the bare triggerRef — so one refund event spanning multiple
  // originals can create more than one row under the existing
  // @@unique([agencyId, triggerSource, triggerRef]) constraint, and a
  // retry safely no-ops on whichever rows already exist.
  assert.match(helperBody, /triggerRef: `\$\{triggerRef\}:\$\{original\.id\}`,\s*\n\s*reversesCreditId: original\.id, collectedAt,/);
  assert.match(helperBody, /if \(error\?\.code !== "P2002"\) throw error;/);
  assert.match(helperBody, /if \(!rows\.length\) return \{ recorded: false, reason: "already_recorded" \};/);

  // A refund larger than everything ever collected on the invoice is
  // flagged rather than silently swallowed.
  assert.match(helperBody, /if \(remaining > 0\.01\) \{\s*\n\s*logger\.warn\("incentive\.revenue_reversal_exceeds_collected"/);

  const schema = await source("../prisma/schema.prisma");
  assert.match(schema, /model IncentiveRevenueCredit \{[\s\S]*?@@unique\(\[agencyId, triggerSource, triggerRef\]\)/);
});
