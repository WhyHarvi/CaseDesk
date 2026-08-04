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

test("deadline scheduler covers actionable work without duplicating appointment reminders", async () => {
  const [scheduler, delivery, service] = await Promise.all([
    source("../src/services/notificationScheduler.js"),
    source("../src/services/notificationDeliveryService.js"),
    source("../src/services/notificationService.js"),
  ]);

  assert.match(scheduler, /taskNotifications/);
  assert.match(scheduler, /followUpNotifications/);
  assert.doesNotMatch(scheduler, /async function appointmentNotifications/);
  assert.match(scheduler, /dedicated[\s\S]*booking email\/SMS pipeline/);
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

test("notification policy groups incidents, separates actions, expires noise, and sends daily summaries", async () => {
  const [schema, migration, service, scheduler, controller, panel, item, booking, inbound] = await Promise.all([
    source("../prisma/schema.prisma"),
    source("../prisma/migrations/20260804190000_quieter_notification_lifecycle/migration.sql"),
    source("../src/services/notificationService.js"),
    source("../src/services/notificationScheduler.js"),
    source("../src/controllers/notificationController.js"),
    source("../../frontend/src/components/notifications/NotificationPanel.jsx"),
    source("../../frontend/src/components/notifications/NotificationItem.jsx"),
    source("../src/services/bookingNotificationService.js"),
    source("../src/services/inboundMailSyncService.js"),
  ]);
  assert.match(schema, /attentionLevel\s+String/);
  assert.match(schema, /occurrenceCount\s+Int/);
  assert.match(schema, /resolvedAt\s+DateTime\?/);
  assert.match(schema, /expiresAt\s+DateTime\?/);
  assert.match(schema, /deliveryMode\s+String/);
  assert.match(migration, /ROW_NUMBER\(\) OVER/);
  assert.match(service, /aggregate = false/);
  assert.match(service, /occurrenceCount: \{ increment: 1 \}/);
  assert.match(service, /export async function resolveNotifications/);
  assert.match(controller, /attentionLevel: "action_required"/);
  assert.match(controller, /resolvedAt: null/);
  assert.match(panel, /Action required/);
  assert.match(panel, /Updates/);
  assert.match(item, /related updates/);
  assert.match(scheduler, /sendDailyDigests/);
  assert.match(scheduler, /resolveCompletedAndExpiredNotifications/);
  assert.match(booking, /kind === "attended"/);
  assert.match(booking, /frontDeskRecipientIds/);
  assert.match(inbound, /aggregate: true/);
  assert.match(inbound, /resolveNotifications/);
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
