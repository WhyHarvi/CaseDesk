import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("a workflow milestone can auto-complete off a case's stage, mirroring the existing payment-installment trigger", async () => {
  const [schema, migration, workflowService, caseController, templateController, panel] = await Promise.all([
    source("../prisma/schema.prisma"),
    source("../prisma/migrations/20260818190000_add_workflow_step_auto_complete/migration.sql"),
    source("../src/services/workflowService.js"),
    source("../src/controllers/caseController.js"),
    source("../src/controllers/workflowTemplateController.js"),
    source("../../frontend/src/components/settings/CaseWorkflowSettingsPanel.jsx"),
  ]);

  assert.match(schema, /model WorkflowTemplateStep \{[\s\S]*autoCompleteTrigger\s+String\?\s+@map\("auto_complete_trigger"\)/);
  assert.match(schema, /model WorkflowTemplateStep \{[\s\S]*autoCompleteStage\s+String\?\s+@map\("auto_complete_stage"\)/);
  assert.match(schema, /model CaseWorkflowStep \{[\s\S]*autoCompleteTrigger\s+String\?\s+@map\("auto_complete_trigger"\)/);
  assert.match(migration, /ALTER TABLE "workflow_template_steps"/);
  assert.match(migration, /ALTER TABLE "case_workflow_steps"/);

  // The template's trigger fields must be copied onto each case's own step
  // at assignment time — same pattern as CasePaymentInstallment copying
  // PaymentScheduleTemplateInstallment's trigger fields.
  assert.match(workflowService, /autoCompleteTrigger: step\.autoCompleteTrigger,\s*\n\s*autoCompleteStage: step\.autoCompleteStage,/);

  // Live-verified directly against the DB: fires only the Pending step
  // whose autoCompleteStage falls strictly between the old and new stage
  // index (never a step someone already completed by hand, never a
  // manual step, and never on a backward move — mirroring
  // evaluateStageTriggers exactly).
  assert.match(workflowService, /export async function evaluateWorkflowStepStageTriggers\(agencyId, caseId, oldStage, newStage, \{ actorUserId, clientId = null \} = \{\}\)/);
  assert.match(workflowService, /if \(newIndex === -1 \|\| newIndex <= oldIndex\) return \[\];/);
  assert.match(workflowService, /where: \{ agencyId, caseId, status: "Pending", autoCompleteTrigger: "Stage" \}/);
  assert.match(workflowService, /action: "workflow_step\.auto_completed"/);

  // Wired into the exact same stage-change hook the payment trigger uses.
  const updateCaseIndex = caseController.indexOf("export async function updateCase(");
  const stageHookIndex = caseController.indexOf('Object.hasOwn(payload, "stage")', updateCaseIndex);
  const stageHookBlock = caseController.slice(stageHookIndex, stageHookIndex + 700);
  assert.match(stageHookBlock, /evaluateStageTriggers\(/);
  assert.match(stageHookBlock, /evaluateWorkflowStepStageTriggers\(req\.auth\.agencyId, result\.data\.id, existing\.stage, payload\.stage, \{ actorUserId: req\.auth\.userId, clientId: existing\.client\.id \}\)/);

  // Template validation: the trigger is a small closed vocabulary (just
  // "Stage" today), and the stage must actually be valid for that
  // template's case type — live-verified an Offer Letter stage (study
  // permit only) is rejected on a Visitor Visa template.
  assert.match(templateController, /const AUTO_COMPLETE_TRIGGERS = new Set\(\["Stage"\]\);/);
  assert.match(templateController, /if \(!stage \|\| !isCaseStageAllowedForType\(caseType, stage\)\) \{/);

  // Frontend: configured per step in the template editor (where it
  // structurally belongs — it applies to every future case of that type),
  // not on already-assigned per-case steps.
  assert.match(panel, /checked={step\.autoCompleteTrigger === "Stage"}/);
  assert.match(panel, /caseStagesForType\(form\.caseType\)/);
  assert.match(panel, /Auto-complete/);
});
