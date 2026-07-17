import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("notifications are durable, tenant scoped, deduplicated, and user owned", async () => {
  const [schema, migration, controller, routes, server] = await Promise.all([
    source("../prisma/schema.prisma"),
    source("../prisma/migrations/20260717090000_add_backend_notifications/migration.sql"),
    source("../src/controllers/notificationController.js"),
    source("../src/routes/notificationRoutes.js"),
    source("../src/server.js"),
  ]);

  assert.match(schema, /model Notification \{/);
  assert.match(schema, /@@unique\(\[agencyId, recipientUserId, dedupeKey\]\)/);
  assert.match(schema, /model NotificationPreference \{/);
  assert.match(schema, /model NotificationDelivery \{/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "notifications"/);
  assert.match(controller, /agencyId: req\.auth\.agencyId/);
  assert.match(controller, /recipientUserId: req\.auth\.userId/);
  assert.match(routes, /\/unread-count/);
  assert.match(routes, /\/read-all/);
  assert.match(routes, /\/preferences\/:category/);
  assert.match(server, /app\.use\("\/api\/notifications", requireAuth, notificationRoutes\)/);
});

test("deadline scheduler covers non-payment work and leaves payments untouched", async () => {
  const [scheduler, delivery, service] = await Promise.all([
    source("../src/services/notificationScheduler.js"),
    source("../src/services/notificationDeliveryService.js"),
    source("../src/services/notificationService.js"),
  ]);

  assert.match(scheduler, /taskNotifications/);
  assert.match(scheduler, /followUpNotifications/);
  assert.match(scheduler, /appointmentNotifications/);
  assert.match(scheduler, /documentNotifications/);
  assert.match(scheduler, /questionnaireNotifications/);
  assert.match(scheduler, /leadNotifications/);
  assert.match(scheduler, /communicationSlaNotifications/);
  assert.doesNotMatch(scheduler, /prisma\.payment|paymentNotifications/);
  assert.match(delivery, /maxAttempts/);
  assert.match(delivery, /inQuietHours/);
  assert.match(delivery, /status: "Consented"/);
  assert.match(service, /agencyId_recipientUserId_dedupeKey/);
  assert.match(service, /id !== actorUserId/);
});

test("document, reminder, and questionnaire notification gaps are normalized", async () => {
  const [schema, assessment, portal, followUps] = await Promise.all([
    source("../prisma/schema.prisma"),
    source("../src/controllers/caseAssessmentController.js"),
    source("../src/controllers/clientPortalController.js"),
    source("../src/controllers/followUpController.js"),
  ]);

  assert.match(schema, /model ClientDocument \{[\s\S]*dueAt\s+DateTime\?/);
  assert.match(schema, /model FollowUp \{[\s\S]*reminderAt\s+DateTime\?/);
  assert.match(schema, /notificationChannels\s+String\[\]/);
  assert.match(schema, /model QuestionnaireAssignment \{/);
  assert.match(assessment, /syncQuestionnaireAssignments/);
  assert.match(portal, /updateNormalizedQuestionnaireAssignment/);
  assert.match(followUps, /legacyReminder/);
  assert.match(followUps, /notifyClient/);
});

test("notification migration backfill preserves jsonb precedence and is retry safe", async () => {
  const migration = await source("../prisma/migrations/20260717090000_add_backend_notifications/migration.sql");

  assert.match(migration, /^BEGIN;/);
  assert.match(migration, /md5\(ca\."id" \|\| ':' \|\| \(assignment\.item_json->>'id'\)\)/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "due_at"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "notifications"/);
  assert.match(migration, /COMMIT;\s*$/);
});
