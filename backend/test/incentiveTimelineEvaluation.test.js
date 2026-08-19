import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("every checkpoint type resolves from real historical data, not a live/current-state read", async () => {
  const service = await source("../src/services/incentiveTimelineService.js");

  // LEAD_CREATED / LEAD_STAGE_REACHED both anchor off the lead that formally
  // converted into this case — the same convertedCaseId lookup resolveHolders
  // already uses, never the "early client" pre-conversion case.
  assert.match(service, /prisma\.lead\.findFirst\(\{ where: \{ convertedCaseId: caseId, agencyId \}, select: \{ createdAt: true \} \}\);/);
  assert.match(service, /prisma\.leadStageHistory\.findFirst\(\{\s*\n\s*where: \{ agencyId, leadId: lead\.id, newStage: checkpointValue \},\s*\n\s*orderBy: \{ createdAt: "asc" \},/);
  assert.match(service, /prisma\.caseStageHistory\.findFirst\(\{\s*\n\s*where: \{ agencyId, caseId, newStage: checkpointValue \},\s*\n\s*orderBy: \{ createdAt: "asc" \},/);
  assert.match(service, /prisma\.incentiveLedgerEntry\.findFirst\(\{\s*\n\s*where: \{ agencyId, caseId, entryType: "CREDIT" \},\s*\n\s*orderBy: \{ creditedAt: "asc" \},/);

  // Every resolver returns null (not throws, not a fallback date) when the
  // checkpoint hasn't happened yet — the caller treats that as "not
  // resolvable yet," not a miss.
  assert.match(service, /return lead\?\.createdAt \|\| null;/);
  assert.match(service, /return row\?\.createdAt \|\| null;/);
  assert.match(service, /return row\?\.creditedAt \|\| null;/);
});

test("the tier lookup is the mirror image of the payment engine's tierRateFor — smallest threshold that still covers elapsed time wins, no match means 0%", async () => {
  const service = await source("../src/services/incentiveTimelineService.js");
  assert.match(service, /function tierMultiplierFor\(tiers, elapsedDays\) \{/);
  assert.match(service, /if \(Number\(tier\.thresholdDays\) >= elapsedDays\) return \{ tierId: tier\.id, multiplierPercent: Number\(tier\.multiplierPercent\) \};/);
  assert.match(service, /return null;\s*\n\}/);
});

test("a negative elapsed time (out-of-order history) is logged as an anomaly, never inverted or clamped to look like an instant completion", async () => {
  const service = await source("../src/services/incentiveTimelineService.js");
  assert.match(service, /if \(elapsedMs < 0\) \{/);
  assert.match(service, /logger\.warn\("incentive\.timeline_leg_negative_elapsed"/);
  assert.match(service, /const match = elapsedMs >= 0 \? tierMultiplierFor\(leg\.tiers, elapsedMs \/ 86_400_000\) : null;/);
});

test("idempotency comes from re-scanning only not-yet-evaluated legs, backstopped by catching a P2002 race on the unique (caseId, legId) constraint", async () => {
  const service = await source("../src/services/incentiveTimelineService.js");
  assert.match(service, /const doneLegIds = new Set\(alreadyEvaluated\.map\(\(row\) => row\.legId\)\);/);
  assert.match(service, /const pendingLegs = legs\.filter\(\(leg\) => !doneLegIds\.has\(leg\.id\)\);/);
  assert.match(service, /if \(error\?\.code !== "P2002"\) throw error;/);
});

test("either endpoint missing skips the leg silently (try again later), but a resolved leg always writes an audit row even when it pays nothing", async () => {
  const service = await source("../src/services/incentiveTimelineService.js");
  assert.match(service, /if \(!fromAt \|\| !toAt\) continue;/);
  // A matched-but-zero-pool result (no tier matched, or a real holder-less
  // share) is written as MISSED_TIMELINE / MISSED_NO_HOLDERS, not skipped.
  assert.match(service, /let outcome = "MISSED_TIMELINE";/);
  assert.match(service, /outcome = "MISSED_NO_HOLDERS";/);
  assert.match(service, /outcome = "CREDITED";/);
  assert.match(service, /await tx\.incentiveTimelineLegEvaluation\.create\(\{/);
});

test("a credited leg writes ledger rows with no invoice, tagged TIMELINE_BONUS and linked back to the evaluation row", async () => {
  const service = await source("../src/services/incentiveTimelineService.js");
  assert.match(service, /caseInvoiceId: null,/);
  assert.match(service, /timelineLegEvaluationId: evaluation\.id,/);
  assert.match(service, /sourceAmountCollected: 0,/);
  assert.match(service, /entryType: "TIMELINE_BONUS",/);
  assert.match(service, /triggerRef: `leg:\$\{leg\.id\}`,/);
});

test("the schema backs every design constraint: nullable caseInvoiceId, a real FK to the plan but plain legId/matchedTierId columns, and the (caseId, legId) idempotency guard", async () => {
  const schema = await source("../prisma/schema.prisma");
  assert.match(schema, /model IncentiveLedgerEntry \{[\s\S]*?caseInvoiceId\s+String\?\s+@map\("case_invoice_id"\)/);
  assert.match(schema, /model IncentiveLedgerEntry \{[\s\S]*?timelineLegEvaluationId String\?\s+@map\("timeline_leg_evaluation_id"\)/);
  assert.match(schema, /model IncentiveTimelineLegEvaluation \{[\s\S]*?legId\s+String\s+@map\("leg_id"\)/);
  assert.match(schema, /model IncentiveTimelineLegEvaluation \{[\s\S]*?matchedTierId\s+String\?\s+@map\("matched_tier_id"\)/);
  assert.match(schema, /model IncentiveTimelineLegEvaluation \{[\s\S]*?incentivePlanId\s+String\s+@map\("incentive_plan_id"\)/);
  assert.match(schema, /model IncentiveTimelineLegEvaluation \{[\s\S]*?incentivePlan\s+IncentivePlan\s+@relation\(fields: \[incentivePlanId\]/);
  assert.match(schema, /model IncentiveTimelineLegEvaluation \{[\s\S]*?@@unique\(\[caseId, legId\]\)/);

  // legId is a plain column, not a real relation — isolate just this
  // model's own body (up to its closing brace) before asserting the
  // absence, so this can't false-match a `leg` field belonging to some
  // other model later in the file.
  const modelStart = schema.indexOf("model IncentiveTimelineLegEvaluation {");
  const modelEnd = schema.indexOf("\n}", modelStart);
  const modelBody = schema.slice(modelStart, modelEnd);
  assert.doesNotMatch(modelBody, /leg\s+IncentivePlanTimelineLeg\s+@relation/);
});
