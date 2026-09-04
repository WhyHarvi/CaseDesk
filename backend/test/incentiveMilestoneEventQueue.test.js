import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

// Problem: case-stage and follow-up controllers committed the underlying
// state change (case.update / follow-up.update) and only then attempted
// creditStudyPermitMilestone as a separate best-effort call with a
// catch-and-log handler. If that call threw, the milestone credit was gone
// — no durable event, nothing for the hourly retry worker to pick up, and
// the state change that should have earned it had already committed and
// can't be re-triggered (a case doesn't re-enter "Submitted").
test("study permit milestones are queued durably before crediting is attempted, not lost on a catch-and-log failure", async () => {
  const [schema, expansionService, creditingService, caseController, lifecycleController, followUpController] = await Promise.all([
    source("../prisma/schema.prisma"),
    source("../src/services/incentiveExpansionService.js"),
    source("../src/services/incentiveCreditingService.js"),
    source("../src/controllers/caseController.js"),
    source("../src/controllers/caseLifecycleController.js"),
    source("../src/controllers/followUpController.js"),
  ]);

  // A durable queue table, keyed the same way IncentiveMilestoneEvaluation
  // is keyed, so a duplicate queue attempt for the same real-world event is
  // a no-op rather than a second retry record.
  assert.match(schema, /model IncentiveMilestoneEvent \{[\s\S]*?@@unique\(\[agencyId, triggerSource, triggerRef, eventType\]\)[\s\S]*?@@map\("incentive_milestone_events"\)\n\}/);

  // recordPendingStudyPermitMilestoneEvent takes an optional db handle
  // (same convention as recordRevenueMovement/getOrCreateActiveIncentivePeriod)
  // so a caller with a live transaction can queue the event atomically with
  // the state change instead of as a separate call after commit.
  assert.match(expansionService, /export async function recordPendingStudyPermitMilestoneEvent\(agencyId, \{ caseId, eventType, triggerSource, triggerRef, occurredAt = new Date\(\), actorUserId = null \}, db = prisma\) \{/);
  assert.match(expansionService, /return await db\.incentiveMilestoneEvent\.create\(/);

  // Processing a pending row always resolves it: creditStudyPermitMilestone
  // returning at all (credited, already_credited, or a definitive
  // no_active_rule/cycle_ineligible/not_study_permit reason) means it made
  // its own idempotent decision, so the row is marked PROCESSED. Only an
  // actual thrown error leaves it PENDING for the next sweep.
  assert.match(expansionService, /export async function processPendingStudyPermitMilestoneEvent\(eventId\) \{/);
  const processStart = expansionService.indexOf("export async function processPendingStudyPermitMilestoneEvent(");
  const processBody = expansionService.slice(processStart, expansionService.indexOf("\nexport async function reconcilePendingStudyPermitMilestoneEvents", processStart));
  assert.match(processBody, /status: "PROCESSED", processedAt: new Date\(\), lastError: null/);
  assert.match(processBody, /attempts: \{ increment: 1 \}/);

  assert.match(expansionService, /export async function reconcilePendingStudyPermitMilestoneEvents\(limit = 100\) \{/);
  assert.match(expansionService, /where: \{ status: "PENDING" \}, orderBy: \{ createdAt: "asc" \}, take: limit/);

  // Wired into the existing hourly incentive retry worker (the same one
  // reconcilePendingIncentiveCredits already runs on) via a dynamic import,
  // matching the existing circular-import workaround convention.
  const runStart = creditingService.indexOf("export function startIncentiveRetryWorker()");
  const runBody = creditingService.slice(runStart, creditingService.indexOf("\n  run();", runStart));
  assert.match(runBody, /reconcilePendingIncentiveCredits\(\)/);
  assert.match(runBody, /import\("\.\/incentiveExpansionService\.js"\)\.then\(\(\{ reconcilePendingStudyPermitMilestoneEvents \}\) =>\s*\n\s*reconcilePendingStudyPermitMilestoneEvents\(\)/);

  // caseController.updateCase: queued with `tx` inside the same transaction
  // that writes caseStageHistory, so a stage change can never commit without
  // a durable record that a milestone credit may be owed. The immediate
  // best-effort creditStudyPermitMilestone call (after commit) now reuses
  // the same milestoneOccurredAt instead of computing a second, different
  // timestamp.
  assert.match(caseController, /const milestoneOccurredAt = new Date\(\);\s*\n\s*const result = await prisma\.\$transaction/);
  const caseTxStart = caseController.indexOf("const result = await prisma.$transaction(async (tx) => {");
  const caseTxBody = caseController.slice(caseTxStart, caseController.indexOf("const caseTypeChanged", caseTxStart));
  assert.match(caseTxBody, /await tx\.caseStageHistory\.create\(/);
  assert.match(caseTxBody, /const milestoneType = STUDY_PERMIT_MILESTONES\[payload\.stage\];\s*\n\s*if \(milestoneType\) await recordPendingStudyPermitMilestoneEvent\(req\.user\.agencyId, \{[\s\S]*?\}, tx\);/);
  assert.ok(caseTxBody.indexOf("tx.caseStageHistory.create") < caseTxBody.indexOf("recordPendingStudyPermitMilestoneEvent"),
    "the stage-history row and the pending milestone event must both be written inside the transaction, history first");
  assert.match(caseController, /if \(milestoneType\) await creditStudyPermitMilestone\(req\.auth\.agencyId, \{[\s\S]*?occurredAt: milestoneOccurredAt,/);

  // caseLifecycleController.updateCaseLifecycle ("Submitted" branch): same
  // shape — queued with `tx` alongside caseStageHistory, and
  // runStageAutomations now takes the same occurredAt explicitly instead of
  // defaulting to a fresh `new Date()` that would drift from the queued
  // event's timestamp.
  assert.match(lifecycleController, /async function runStageAutomations\(agencyId, caseId, clientId, previousStage, nextStage, actorUserId, occurredAt = new Date\(\)\) \{/);
  assert.match(lifecycleController, /triggerRef: `\$\{caseId\}:\$\{nextStage\}`, occurredAt, actorUserId,/);
  const lifecycleTxStart = lifecycleController.indexOf('if (requestedStage === "Submitted") {');
  const lifecycleTxBody = lifecycleController.slice(lifecycleTxStart, lifecycleController.indexOf("return updated;", lifecycleTxStart));
  assert.match(lifecycleTxBody, /const milestoneOccurredAt = new Date\(\);/);
  assert.match(lifecycleTxBody, /await tx\.caseStageHistory\.create\(/);
  assert.match(lifecycleTxBody, /if \(milestoneType\) await recordPendingStudyPermitMilestoneEvent\(req\.auth\.agencyId, \{[\s\S]*?\}, tx\);/);
  assert.match(lifecycleController, /await runStageAutomations\(req\.auth\.agencyId, sourceCase\.id, sourceCase\.clientId, sourceCase\.stage, "Submitted", req\.auth\.userId, milestoneOccurredAt\);/);

  // followUpController: the generic CRUD helper (prismaCrud.js) commits its
  // update before running afterUpdate, so there is no reachable transaction
  // to queue this atomically with. The queue write still runs first, before
  // the best-effort crediting attempt, so a crediting failure alone can no
  // longer lose the milestone outright.
  const followUpStart = followUpController.indexOf('if (data.caseId && data.followUpType === POST_SUBMISSION_FOLLOW_UP_TYPE) {');
  const followUpBody = followUpController.slice(followUpStart, followUpController.indexOf("\n      }", followUpController.indexOf("creditStudyPermitMilestone", followUpStart)));
  assert.match(followUpBody, /const milestoneOccurredAt = data\.completedAt \|\| new Date\(\);/);
  assert.ok(followUpBody.indexOf("recordPendingStudyPermitMilestoneEvent") < followUpBody.indexOf("await creditStudyPermitMilestone"),
    "the pending event must be queued before the best-effort crediting attempt");
  assert.match(followUpBody, /recordPendingStudyPermitMilestoneEvent\(req\.auth\.agencyId, \{[\s\S]*?occurredAt: milestoneOccurredAt,[\s\S]*?\}\)\.catch/);
});
