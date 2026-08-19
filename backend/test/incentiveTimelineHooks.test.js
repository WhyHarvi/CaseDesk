import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("timeline-bonus evaluation is wired into all 3 hook points, each best-effort and never able to fail the action it's reacting to", async () => {
  const [leadController, caseController, creditingService] = await Promise.all([
    source("../src/modules/leads/lead.controller.js"),
    source("../src/controllers/caseController.js"),
    source("../src/services/incentiveCreditingService.js"),
  ]);

  // 1. Lead conversion — the only hook for LEAD_CREATED/LEAD_STAGE_REACHED
  // legs, since plan resolution needs caseType, which doesn't exist until
  // this case does.
  assert.match(leadController, /await evaluateCaseTimelineLegs\(req\.auth\.agencyId, result\.case\.id\)\.catch\(\(error\) => \{\s*\n\s*logger\.warn\("lead\.timeline_bonus_evaluation_failed"/);

  // 2. Case stage change — alongside the existing payment/workflow stage
  // triggers, same gating (payload.stage !== existing.stage).
  const updateCaseIndex = caseController.indexOf("export async function updateCase(");
  const recordActivityIndex = caseController.indexOf("await recordActivity(", updateCaseIndex);
  const stageHookIndex = caseController.indexOf('Object.hasOwn(payload, "stage")', recordActivityIndex);
  const stageHookBlock = caseController.slice(stageHookIndex, stageHookIndex + 900);
  assert.match(stageHookBlock, /evaluateStageTriggers\(/);
  assert.match(stageHookBlock, /evaluateWorkflowStepStageTriggers\(/);
  assert.match(stageHookBlock, /await evaluateCaseTimelineLegs\(req\.auth\.agencyId, result\.data\.id\)\.catch\(\(error\) => \{\s*\n\s*logger\.warn\("case\.timeline_bonus_evaluation_failed"/);

  // 3. Payment collection — inside creditCaseInvoiceCollection, only after a
  // genuine non-reversal credit (result.credited), which also gives
  // FIRST_PAYMENT_COLLECTED legs a free retry sweep via the existing
  // reconcilePendingIncentiveCredits worker.
  const creditedBlockIndex = creditingService.indexOf("if (result.credited) {");
  const creditedBlock = creditingService.slice(creditedBlockIndex, creditedBlockIndex + 500);
  assert.match(creditedBlock, /await evaluateCaseTimelineLegs\(agencyId, caseId\)\.catch\(\(error\) => \{\s*\n\s*logger\.warn\("incentive\.timeline_bonus_evaluation_failed"/);
});

test("the case-stage-change hook writes CaseStageHistory inside the same transaction as the case update, ahead of the (best-effort, post-transaction) timeline evaluation call", async () => {
  const controller = await source("../src/controllers/caseController.js");
  const transactionIndex = controller.indexOf("prisma.$transaction(async (tx) => {");
  const historyWriteIndex = controller.indexOf("tx.caseStageHistory.create(", transactionIndex);
  const timelineHookIndex = controller.indexOf("evaluateCaseTimelineLegs(", transactionIndex);

  assert.ok(historyWriteIndex > transactionIndex, "history write must be inside the transaction");
  assert.ok(timelineHookIndex > historyWriteIndex, "timeline evaluation must run after the transaction commits, using the durable history it wrote");
});

test("evaluateCaseTimelineLegs and incentiveCreditingService's resolvePlan/resolveHolders/computeSplits form a real (safe) circular import — both directions use hoisted function declarations, never top-level values", async () => {
  const [creditingService, timelineService] = await Promise.all([
    source("../src/services/incentiveCreditingService.js"),
    source("../src/services/incentiveTimelineService.js"),
  ]);
  assert.match(creditingService, /import \{ evaluateCaseTimelineLegs \} from "\.\/incentiveTimelineService\.js";/);
  assert.match(timelineService, /import \{ resolvePlan, resolveHolders, computeSplits \} from "\.\/incentiveCreditingService\.js";/);
  assert.match(creditingService, /export async function resolvePlan\(/);
  assert.match(creditingService, /export async function resolveHolders\(/);
  assert.match(creditingService, /export function computeSplits\(/);
});

test("the Incentives ledger table and its backing query surface a credited timeline bonus with the milestone name, not just the plan name", async () => {
  const [controller, page] = await Promise.all([
    source("../src/controllers/incentiveLedgerController.js"),
    source("../../frontend/src/pages/Incentives.jsx"),
  ]);
  assert.match(controller, /timelineLegEvaluation: \{ select: \{ legNameSnapshot: true, elapsedMinutes: true, multiplierPercent: true \} \}/);
  assert.match(page, /const isTimelineBonus = row\.entryType === "TIMELINE_BONUS";/);
  assert.match(page, /row\.timelineLegEvaluation\?\.legNameSnapshot/);
});
