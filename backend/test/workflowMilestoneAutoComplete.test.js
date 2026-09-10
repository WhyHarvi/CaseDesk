import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  evaluateWorkflowStepEventTriggers,
  getDefaultWorkflowTemplates,
  workflowEventForActivityAction,
  WORKFLOW_AUTO_COMPLETE_EVENTS,
} from "../src/services/workflowService.js";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("workflow milestones support hybrid stage, verified-event, and manual completion", async () => {
  const [schema, stageMigration, eventMigration, workflowService, caseController, caseWorkflowController, templateController, activityCrud, panel, timeline, drafts, caseProfile, quickBooksWebhook] = await Promise.all([
    source("../prisma/schema.prisma"),
    source("../prisma/migrations/20260818190000_add_workflow_step_auto_complete/migration.sql"),
    source("../prisma/migrations/20260910213000_add_workflow_event_triggers/migration.sql"),
    source("../src/services/workflowService.js"),
    source("../src/controllers/caseController.js"),
    source("../src/controllers/caseWorkflowController.js"),
    source("../src/controllers/workflowTemplateController.js"),
    source("../src/utils/prismaCrud.js"),
    source("../../frontend/src/components/settings/CaseWorkflowSettingsPanel.jsx"),
    source("../../frontend/src/components/case-profile/WorkflowTimeline.jsx"),
    source("../../frontend/src/components/case-profile/workflowDrafts.js"),
    source("../../frontend/src/pages/CaseProfile.jsx"),
    source("../src/services/quickbooksWebhookService.js"),
  ]);

  assert.match(schema, /model WorkflowTemplateStep \{[\s\S]*autoCompleteTrigger\s+String\?\s+@map\("auto_complete_trigger"\)/);
  assert.match(schema, /model WorkflowTemplateStep \{[\s\S]*autoCompleteStage\s+String\?\s+@map\("auto_complete_stage"\)/);
  assert.match(schema, /model CaseWorkflowStep \{[\s\S]*autoCompleteTrigger\s+String\?\s+@map\("auto_complete_trigger"\)/);
  assert.match(schema, /model WorkflowTemplateStep \{[\s\S]*autoCompleteEvent\s+String\?\s+@map\("auto_complete_event"\)/);
  assert.match(schema, /model CaseWorkflowStep \{[\s\S]*autoCompleteEvent\s+String\?\s+@map\("auto_complete_event"\)/);
  assert.match(stageMigration, /ALTER TABLE "workflow_template_steps"/);
  assert.match(stageMigration, /ALTER TABLE "case_workflow_steps"/);
  assert.match(eventMigration, /ADD COLUMN "auto_complete_event" TEXT/);

  // The template's trigger fields must be copied onto each case's own step
  // at assignment time — same pattern as CasePaymentInstallment copying
  // PaymentScheduleTemplateInstallment's trigger fields.
  assert.match(workflowService, /autoCompleteTrigger: step\.autoCompleteTrigger,\s*\n\s*autoCompleteStage: step\.autoCompleteStage,\s*\n\s*autoCompleteEvent: step\.autoCompleteEvent,/);
  assert.match(caseWorkflowController, /autoCompleteEvent: step\.autoCompleteEvent/);
  assert.match(drafts, /autoCompleteEvent: step\.autoCompleteEvent \|\| null/);
  assert.match(caseProfile, /autoCompleteEvent: step\.autoCompleteEvent \|\| null/);
  assert.match(workflowService, /async function syncCaseWorkflowAutomationFromTemplate/);
  assert.match(workflowService, /templateStepId: templateStep\.id,\s*\n\s*autoCompleteTrigger: nextTrigger,\s*\n\s*autoCompleteStage: nextStage,\s*\n\s*autoCompleteEvent: nextEvent/);
  assert.match(caseWorkflowController, /reconcileNewWorkflowAutomation\(agencyId, scopedCase\.id, assignment\.automationUpdatedStepIds/);

  // Live-verified directly against the DB: fires only the Pending step
  // whose autoCompleteStage falls strictly between the old and new stage
  // index (never a step someone already completed by hand, never a
  // manual step, and never on a backward move — mirroring
  // evaluateStageTriggers exactly).
  assert.match(workflowService, /export async function evaluateWorkflowStepStageTriggers\(agencyId, caseId, oldStage, newStage, \{ actorUserId, clientId = null \} = \{\}\)/);
  assert.match(workflowService, /if \(newIndex === -1 \|\| newIndex <= oldIndex\) return \[\];/);
  assert.match(workflowService, /where: \{ agencyId, caseId, isActive: true, isStandaloneTask: false, status: "Pending", autoCompleteTrigger: "Stage" \}/);
  assert.match(workflowService, /action: "workflow_step\.auto_completed"/);

  // Wired into the exact same stage-change hook the payment trigger uses.
  // Anchored past recordActivity so this finds the post-transaction hook
  // block, not the earlier in-transaction CaseStageHistory guard (same
  // condition text, different purpose — see incentiveTimelineHooks.test.js).
  const updateCaseIndex = caseController.indexOf("export async function updateCase(");
  const recordActivityIndex = caseController.indexOf("await recordActivity(", updateCaseIndex);
  const stageHookIndex = caseController.indexOf('Object.hasOwn(payload, "stage")', recordActivityIndex);
  const stageHookBlock = caseController.slice(stageHookIndex, stageHookIndex + 700);
  assert.match(stageHookBlock, /evaluateStageTriggers\(/);
  assert.match(stageHookBlock, /evaluateWorkflowStepStageTriggers\(req\.auth\.agencyId, result\.data\.id, existing\.stage, payload\.stage, \{ actorUserId: req\.auth\.userId, clientId: existing\.client\.id \}\)/);

  // Template validation keeps both trigger and event names in closed
  // vocabularies, and the stage must actually be valid for that
  // template's case type — live-verified an Offer Letter stage (study
  // permit only) is rejected on a Visitor Visa template.
  assert.match(templateController, /const AUTO_COMPLETE_TRIGGERS = new Set\(\["Stage", "Event"\]\);/);
  assert.match(templateController, /const AUTO_COMPLETE_EVENTS = new Set\(Object\.values\(WORKFLOW_AUTO_COMPLETE_EVENTS\)\);/);
  assert.match(templateController, /if \(!stage \|\| !isCaseStageAllowedForType\(caseType, stage\)\) \{/);

  // Frontend: each template milestone clearly chooses Manual, a case
  // stage, or a verified event. The case timeline exposes the configured
  // rule while still retaining its manual toggle.
  assert.match(panel, /<option value="Manual">Manual<\/option>/);
  assert.match(panel, /<option value="Stage">At case stage<\/option>/);
  assert.match(panel, /<option value="Event">After verified event<\/option>/);
  assert.match(panel, /caseStagesForType\(form\.caseType\)/);
  assert.match(timeline, /function automationLabel\(step\)/);
  assert.match(timeline, /onClick=\{\(\) => onToggleStep\(step\)\}/);

  // All event-driven completion flows through ActivityLog evidence. A QBO
  // invoice transition emits the same durable paid event as CaseDesk's
  // manual payment path.
  assert.match(activityCrud, /workflowEventForActivityAction\(action\)/);
  assert.match(activityCrud, /evaluateWorkflowStepEventTriggers\(agencyId, caseId, workflowEvent/);
  assert.match(quickBooksWebhook, /Number\(row\.balance\) > 0\.005 && Number\(updated\.balance\) <= 0\.005/);
  assert.match(quickBooksWebhook, /action: "invoice\.paid"/);
});

test("verified workflow event completion is atomic, idempotent, and auditable", async () => {
  const activities = [];
  let pending = true;
  const step = {
    id: "step-1",
    title: "Retainer Agreement",
    status: "Pending",
    autoCompleteTrigger: "Event",
    autoCompleteEvent: WORKFLOW_AUTO_COMPLETE_EVENTS.RETAINER_SIGNED,
  };
  const db = {
    caseWorkflowStep: {
      findMany: async () => (pending ? [step] : []),
      updateMany: async () => {
        if (!pending) return { count: 0 };
        pending = false;
        return { count: 1 };
      },
    },
  };
  const options = {
    db,
    actorUserId: "user-1",
    clientId: "client-1",
    occurredAt: new Date("2026-09-10T12:00:00.000Z"),
    sourceAction: "correspondence.portal_signed",
    activityRecorder: async (activity) => activities.push(activity),
  };

  const first = await evaluateWorkflowStepEventTriggers("agency-1", "case-1", WORKFLOW_AUTO_COMPLETE_EVENTS.RETAINER_SIGNED, options);
  const second = await evaluateWorkflowStepEventTriggers("agency-1", "case-1", WORKFLOW_AUTO_COMPLETE_EVENTS.RETAINER_SIGNED, options);

  assert.equal(first.length, 1);
  assert.equal(second.length, 0);
  assert.equal(activities.length, 1);
  assert.equal(activities[0].action, "workflow_step.auto_completed");
  assert.equal(activities[0].metadata.sourceAction, "correspondence.portal_signed");
  assert.equal(workflowEventForActivityAction("invoice.manual_payment_recorded"), WORKFLOW_AUTO_COMPLETE_EVENTS.PAYMENT_CONFIRMED);
  assert.equal(workflowEventForActivityAction("questionnaire.reviewed"), WORKFLOW_AUTO_COMPLETE_EVENTS.QUESTIONNAIRE_SUBMITTED);
  assert.equal(workflowEventForActivityAction("client_document.uploaded"), null);
});

test("built-in retainer completion requires both signature and payment evidence", async () => {
  const retainer = getDefaultWorkflowTemplates()
    .find((template) => template.caseType === "Study Permit")
    .steps.find((step) => step.title === "Retainer Agreement");
  assert.equal(retainer.autoCompleteEvent, WORKFLOW_AUTO_COMPLETE_EVENTS.RETAINER_AND_PAYMENT_CONFIRMED);

  let pending = true;
  let evidence = [{ action: "correspondence.portal_signed" }];
  const db = {
    caseWorkflowStep: {
      findMany: async () => pending ? [{ id: "step-2", title: "Retainer Agreement", autoCompleteEvent: WORKFLOW_AUTO_COMPLETE_EVENTS.RETAINER_AND_PAYMENT_CONFIRMED }] : [],
      updateMany: async () => {
        pending = false;
        return { count: 1 };
      },
    },
    activityLog: { findMany: async () => evidence },
  };
  const options = { db, activityRecorder: async () => {} };

  const signatureOnly = await evaluateWorkflowStepEventTriggers("agency-1", "case-1", WORKFLOW_AUTO_COMPLETE_EVENTS.RETAINER_SIGNED, options);
  assert.equal(signatureOnly.length, 0);
  assert.equal(pending, true);

  evidence = [...evidence, { action: "invoice.manual_payment_recorded" }];
  const signedAndPaid = await evaluateWorkflowStepEventTriggers("agency-1", "case-1", WORKFLOW_AUTO_COMPLETE_EVENTS.PAYMENT_CONFIRMED, options);
  assert.equal(signedAndPaid.length, 1);
  assert.equal(pending, false);
});
