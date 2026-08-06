import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("resolved notifications cancel queued external deliveries", async () => {
  const [notifications, worker] = await Promise.all([
    source("../src/services/notificationService.js"),
    source("../src/services/notificationDeliveryService.js"),
  ]);
  assert.match(notifications, /status: \{ in: \["pending", "retry"\] \}/);
  assert.match(notifications, /status: "cancelled"/);
  assert.match(worker, /job\.notification\.resolvedAt/);
  assert.match(worker, /Cancelled because the notification was resolved/);
});

test("completion is not reported as failed when notification cleanup needs reconciliation", async () => {
  const [controller, worker] = await Promise.all([
    source("../src/controllers/followUpController.js"),
    source("../src/services/notificationDeliveryService.js"),
  ]);
  assert.match(controller, /async function resolveFollowUpNotificationsSafely/);
  assert.match(controller, /follow_up\.notification_resolution_failed/);
  assert.match(controller, /await resolveFollowUpNotificationsSafely\(/);
  assert.match(worker, /async function terminalEntityReason/);
  assert.match(worker, /\["Completed", "Cancelled"\]\.includes\(followUp\.status\)/);
  assert.match(worker, /const claimedTerminalReason = await terminalEntityReason\(job\.notification\)/);
});

test("follow-up schema stores accountable actors and structured links", async () => {
  const [schema, migration] = await Promise.all([
    source("../prisma/schema.prisma"),
    source("../prisma/migrations/20260806110000_follow_up_workflow_integrity/migration.sql"),
  ]);
  for (const field of ["createdById", "completedById", "cancelledById", "completionOutcome", "cancellationReason", "documentId", "caseInvoiceId", "expiresAt"]) {
    assert.match(schema, new RegExp(`\\b${field}\\b`));
  }
  assert.match(migration, /SET "status" = 'Pending'/);
});

test("the shared queue includes lead work, server pagination, and safe outcome actions", async () => {
  const [controller, page, workload] = await Promise.all([
    source("../src/controllers/followUpController.js"),
    source("../../frontend/src/pages/FollowUps.jsx"),
    source("../src/controllers/adminConsultantController.js"),
  ]);
  assert.match(controller, /prisma\.leadFollowUp\.findMany/);
  assert.match(controller, /uniqueClients/);
  assert.match(page, /my_open/);
  assert.match(page, /completionOutcomes/);
  assert.match(page, /cancellationReason/);
  assert.match(page, /\/leads\/\$\{action\.item\.leadId\}\/follow-ups/);
  assert.match(page, /\^\[=\+\\-@\]/);
  assert.match(workload, /leadFollowUps\.forEach/);
});

test("import-review lead follow-ups stay out of shared queues and dashboards", async () => {
  const [followUps, dashboard, workload, scheduler] = await Promise.all([
    source("../src/controllers/followUpController.js"),
    source("../src/controllers/dashboardController.js"),
    source("../src/controllers/adminConsultantController.js"),
    source("../src/services/notificationScheduler.js"),
  ]);
  assert.match(followUps, /clauses = \[leadFollowUpAccessWhere\(req\), \{ lead: leadSegmentWhere\(\) \}\]/);
  assert.match(dashboard, /leadFollowUpWhere = \{[\s\S]*lead: leadSegmentWhere\(\)/);
  assert.match(workload, /prisma\.leadFollowUp\.findMany\(\{[\s\S]*lead: \{[\s\S]*\.\.\.leadSegmentWhere\(\)/);
  assert.match(scheduler, /prisma\.leadFollowUp\.findMany\(\{ where: \{[\s\S]*lead: leadSegmentWhere\(\)/);
});

test("closing the last open lead follow-up requires and atomically creates the next action", async () => {
  const [service, validation, controller, sharedPage, leadActions] = await Promise.all([
    source("../src/modules/leads/lead.service.js"),
    source("../src/modules/leads/lead.validation.js"),
    source("../src/controllers/followUpController.js"),
    source("../../frontend/src/pages/FollowUps.jsx"),
    source("../../frontend/src/modules/leads/components/LeadActionSheets.jsx"),
  ]);
  assert.match(validation, /nextFollowUp: body\.nextFollowUp \? parseLeadFollowUp\(body\.nextFollowUp\) : null/);
  assert.match(service, /NEXT_FOLLOW_UP_REQUIRED/);
  assert.match(service, /next = await tx\.leadFollowUp\.create/);
  assert.match(controller, /requiresNextFollowUp:/);
  assert.match(sharedPage, /Add the lead’s next action/);
  assert.match(leadActions, /An open lead cannot be left without an assigned follow-up/);
});
