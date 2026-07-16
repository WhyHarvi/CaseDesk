import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("assigned-case applicants can be edited and safely detached", async () => {
  const [controller, routes, overlay, card] = await Promise.all([
    source("../src/controllers/caseApplicantController.js"),
    source("../src/routes/caseRoutes.js"),
    source("../../frontend/src/components/case-profile/applicants/ApplicantsOverlay.jsx"),
    source("../../frontend/src/components/case-profile/applicants/ApplicantCard.jsx"),
  ]);

  assert.match(routes, /router\.patch\("\/:id\/applicants\/:applicantId"/);
  assert.match(routes, /router\.delete\("\/:id\/applicants\/:applicantId"/);
  assert.match(controller, /caseAccesses: \{ some: \{ caseId \} \}/);
  assert.match(controller, /inaccessibleExistingIds/);
  assert.match(controller, /filter\(\(access\) => referenceById\.has\(access\.caseId\)\)/);
  assert.match(controller, /profileId_caseId/);
  assert.match(controller, /case\.applicant\.updated/);
  assert.match(controller, /case\.applicant\.removed/);
  assert.match(overlay, /api\.patch\(`\/cases\/\$\{caseItem\.id\}\/applicants\/\$\{draft\.id\}`/);
  assert.match(overlay, /Remove from case/);
  assert.match(card, /!applicant\.isPrimary/);
});

test("task cancellation preserves records and activity instead of deleting rows", async () => {
  const [schema, migration, controller, routes, workspace, page] = await Promise.all([
    source("../prisma/schema.prisma"),
    source("../prisma/migrations/20260715180000_add_cancelled_case_task_status/migration.sql"),
    source("../src/controllers/caseWorkflowController.js"),
    source("../src/routes/caseRoutes.js"),
    source("../../frontend/src/components/case-profile/TasksWorkspace.jsx"),
    source("../../frontend/src/pages/CaseProfile.jsx"),
  ]);

  assert.match(schema, /enum CaseWorkflowStepStatus \{[\s\S]*Cancelled/);
  assert.match(migration, /ADD VALUE IF NOT EXISTS 'Cancelled'/);
  assert.match(routes, /tasks\/:taskId\/cancel/);
  assert.doesNotMatch(routes, /router\.delete\("\/:id\/tasks/);
  assert.match(controller, /data: \{ status: "Cancelled", completedAt: null, isActive: false \}/);
  assert.match(controller, /action: "task\.cancelled"/);
  assert.doesNotMatch(controller, /caseWorkflowStep\.delete\(\{ where: \{ id: existing\.id \} \}\)/);
  assert.match(controller, /role: \{ in: \["admin", "consultant"\] \}/);
  assert.match(workspace, /\["cancelled", "Cancelled"\]/);
  assert.match(workspace, /Cancelled work remains visible here for reference/);
  assert.match(page, /tasks\/\$\{task\.id\}\/cancel/);
});

test("case operations continue to feed the consultant-safe activity timeline", async () => {
  const [activityController, activityRoutes, applicantController, taskController] = await Promise.all([
    source("../src/controllers/activityLogController.js"),
    source("../src/routes/activityLogRoutes.js"),
    source("../src/controllers/caseApplicantController.js"),
    source("../src/controllers/caseWorkflowController.js"),
  ]);

  assert.match(activityController, /buildAccessWhere: relatedRecordAccessWhere/);
  assert.match(activityController, /caseId: req\.query\.caseId/);
  assert.doesNotMatch(activityRoutes, /post|patch|delete/i);
  assert.match(applicantController, /recordActivity\(/);
  assert.match(taskController, /recordActivity\(/);
});
