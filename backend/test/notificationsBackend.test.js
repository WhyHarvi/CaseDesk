import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  caseNotificationActionUrl,
  caseTabFromNotification,
  clearNotificationDedupeCache,
  destinationFromNotification,
  hasKnownNotificationDedupe,
  rememberNotificationDedupe,
} from "../src/services/notificationService.js";
import {
  NOTIFICATION_AUDIENCES,
  notificationAllowedForMembership,
  notificationAudienceKey,
} from "../src/services/notificationAccessService.js";
import { focusedNotificationActionUrl } from "../src/controllers/notificationController.js";

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

test("known non-aggregate notification dedupe keys skip repeated scheduler database checks", () => {
  clearNotificationDedupeCache();
  assert.equal(hasKnownNotificationDedupe("agency-a", "user-a", "task:1", 1_000), false);
  rememberNotificationDedupe("agency-a", "user-a", "task:1", 1_000);
  assert.equal(hasKnownNotificationDedupe("agency-a", "user-a", "task:1", 2_000), true);
  assert.equal(hasKnownNotificationDedupe("agency-a", "user-b", "task:1", 2_000), false);
  assert.equal(hasKnownNotificationDedupe("agency-b", "user-a", "task:1", 2_000), false);
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
  assert.match(scheduler, /NOTIFICATION_RESOLUTION_BATCH_SIZE/);
  assert.match(scheduler, /NOTIFICATION_ENTITY_RECHECK_MS/);
  assert.match(scheduler, /notificationResolutionCursor/);
  assert.doesNotMatch(scheduler, /take:\s*2000/);
  assert.match(scheduler, /notificationId: \{ in: expiredIds \}/);
  assert.match(booking, /kind === "attended"/);
  assert.match(booking, /schedulingCoordinatorRecipientIds/);
  assert.match(inbound, /aggregate: true/);
  assert.match(inbound, /resolveNotifications/);
});

test("notification authorization separates financial work from scheduling work", () => {
  const paymentAlert = {
    type: "booking_payment.etransfer_pending",
    category: "payments",
    destinationKey: "calendar",
    actionUrl: "/app/calendar?appointment=appointment-1",
  };
  assert.equal(
    notificationAudienceKey(paymentAlert),
    NOTIFICATION_AUDIENCES.FINANCE,
  );
  assert.equal(
    notificationAllowedForMembership(
      { role: "frontdesk", permissions: {} },
      paymentAlert,
    ),
    false,
  );
  assert.equal(
    notificationAllowedForMembership(
      { role: "consultant", permissions: {} },
      paymentAlert,
    ),
    false,
  );
  assert.equal(
    notificationAllowedForMembership(
      {
        role: "frontdesk",
        permissions: {
          portalAccess: {
            pages: { payments: true, calendar: true },
            capabilities: { financialData: true },
          },
        },
      },
      paymentAlert,
    ),
    true,
  );
  assert.equal(
    notificationAllowedForMembership(
      { role: "admin", permissions: {} },
      paymentAlert,
    ),
    true,
  );

  const appointmentAlert = {
    type: "appointment.cancelled",
    category: "appointments",
    destinationKey: "calendar",
    actionUrl: "/app/calendar?appointment=appointment-1",
  };
  assert.equal(
    notificationAllowedForMembership(
      { role: "frontdesk", permissions: {} },
      appointmentAlert,
    ),
    true,
  );
  assert.equal(
    notificationAudienceKey({
      type: "appointment.cancelled",
      category: "appointments",
      destinationKey: "calendar",
      metadata: { paidCancellationReview: true },
    }),
    NOTIFICATION_AUDIENCES.FINANCE,
  );
});

test("payment producers use the financial audience and cancellation notices are split", async () => {
  const [holds, quickbooks, booking, controller, delivery, provider] = await Promise.all([
    source("../src/services/bookingPaymentHoldService.js"),
    source("../src/services/quickbooksWebhookService.js"),
    source("../src/services/bookingNotificationService.js"),
    source("../src/controllers/notificationController.js"),
    source("../src/services/notificationDeliveryService.js"),
    source("../../frontend/src/components/notifications/NotificationProvider.jsx"),
  ]);
  assert.match(holds, /financialOperationsRecipientIds/);
  assert.doesNotMatch(holds, /schedulingCoordinatorRecipientIds/);
  assert.match(quickbooks, /financialOperationsRecipientIds/);
  assert.doesNotMatch(quickbooks, /schedulingCoordinatorRecipientIds/);
  assert.match(booking, /kind === "payment_requested"/);
  assert.match(booking, /booking_payment\.refund_review_required/);
  assert.match(booking, /audienceKey: "scheduling"/);
  assert.match(booking, /audienceKey: "finance"/);
  assert.match(controller, /reconcileNotificationAccessForUser/);
  assert.match(controller, /Payments access is required to configure payment notifications/);
  assert.match(delivery, /notificationAllowedForMembership/);
  assert.match(delivery, /cancelUnauthorizedNotification/);
  assert.match(provider, /isFinancialNotification/);
  assert.match(provider, /Payments access is not enabled/);
  assert.match(provider, /notification\.type === "payment\.approval_required"/);
  assert.match(provider, /if \(current\.resolvedAt\)/);
  assert.match(provider, /This payment request has already been completed/);
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

test("sidebar notification destinations follow the page that can resolve the update", () => {
  assert.equal(destinationFromNotification({ actionUrl: "/app/payments", category: "appointments", type: "booking_payment.refunded" }), "payments");
  assert.equal(destinationFromNotification({ actionUrl: "/app/cases/case-1", category: "documents", type: "client_document.portal_uploaded" }), "documents");
  assert.equal(destinationFromNotification({ actionUrl: "/app/cases/case-1", category: "communications", type: "communication.portal_message_received" }), "cases");
  assert.equal(destinationFromNotification({ actionUrl: "/client-portal/chat", category: "communications", type: "communication.staff_reply" }), "portalChat");
  assert.equal(destinationFromNotification({ actionUrl: "/client-portal/payments", category: "payments", type: "invoice.created" }), "portalPayments");
});

// Regression: workload.zero_activity notifications (actionUrl /app/workload,
// category "team") matched none of the known routes or categories and fell
// through to the generic "cases" default, wrongly inflating the Cases
// sidebar badge with notifications that have nothing to do with casework.
test("workload notifications route to their own sidebar destination, not Cases", () => {
  assert.equal(destinationFromNotification({ actionUrl: "/app/workload", category: "team", type: "workload.zero_activity" }), "workload");
});

test("financial exception notifications deep-link to the exact review surface", () => {
  assert.equal(
    focusedNotificationActionUrl({
      type: "booking_payment.refund_unmatched",
      entityId: "refund/42",
      actionUrl: "/app/payments",
    }),
    "/app/payments?source=booking_payment&refund=refund%2F42",
  );
  assert.equal(
    focusedNotificationActionUrl({
      type: "booking_payment.refund_ambiguous",
      entityId: "refund-2",
      actionUrl: "/app/payments",
    }),
    "/app/payments?source=booking_payment&refund=refund-2",
  );
  assert.equal(
    focusedNotificationActionUrl({
      type: "booking_payment.orphaned",
      entityId: "hold-7",
      actionUrl: "/app/payments",
    }),
    "/app/payments?source=booking_payment&hold=hold-7",
  );
  assert.equal(
    focusedNotificationActionUrl({
      type: "booking_payment.etransfer_pending",
      entityType: "bookingPaymentHold",
      entityId: "hold-8",
      metadata: { appointmentId: "appointment/8" },
      actionUrl: "/app/payments",
    }),
    "/app/calendar?appointment=appointment%2F8",
  );
  assert.equal(
    focusedNotificationActionUrl({
      type: "appointment.meeting_sync_failed",
      entityType: "appointment",
      entityId: "appointment-4",
      actionUrl: "/app/calendar",
    }),
    "/app/calendar?appointment=appointment-4",
  );
  assert.equal(
    focusedNotificationActionUrl({
      type: "lead.next_action_overdue",
      entityType: "lead",
      entityId: "lead-9",
      actionUrl: "/leads",
    }),
    "/leads?lead=lead-9",
  );
});

test("case workspace notifications map to the tab containing the affected record", () => {
  assert.equal(caseTabFromNotification({ type: "client_document.portal_uploaded", category: "documents", actionUrl: "/app/cases/case-1" }), "documents");
  assert.equal(caseTabFromNotification({ type: "case_form.review_comment_added", category: "documents", actionUrl: "/app/cases/case-1" }), "forms");
  assert.equal(caseTabFromNotification({ type: "communication.portal_message_received", category: "communications", actionUrl: "/app/cases/case-1" }), "communication");
  assert.equal(caseTabFromNotification({ type: "installment.invoiced", category: "payments", actionUrl: "/app/cases/case-1?tab=billing" }), "billing");
  // follow_up.* shares the "work" category with task.* — a follow-up must
  // still resolve to the Reminders tab, not fall through to Tasks just
  // because of the shared category.
  assert.equal(caseTabFromNotification({ type: "follow_up.due", category: "work" }), "reminders");
  assert.equal(caseTabFromNotification({ type: "follow_up.overdue", category: "work" }), "reminders");
  assert.equal(caseTabFromNotification({ type: "task.overdue", category: "work" }), "tasks");
});

test("case notification links land on the right tab and highlight the specific row when the workspace supports it", () => {
  assert.equal(
    caseNotificationActionUrl("case-1", { type: "task.overdue", category: "work", entityId: "task-1" }),
    "/app/cases/case-1?tab=tasks&highlight=task-1",
  );
  assert.equal(
    caseNotificationActionUrl("case-1", { type: "follow_up.reminder", category: "work", entityId: "followup-1" }),
    "/app/cases/case-1?tab=reminders&highlight=followup-1",
  );
  assert.equal(
    caseNotificationActionUrl("case-1", { type: "client_document.file_uploaded", category: "documents", entityId: "doc-1" }),
    "/app/cases/case-1?tab=documents&highlight=doc-1",
  );
  assert.equal(
    caseNotificationActionUrl("case-1", { type: "installment.voided", category: "payments", entityId: "invoice-1" }),
    "/app/cases/case-1?tab=billing&highlight=invoice-1",
  );
  // No entityId (or a tab whose workspace has no row-highlight support yet,
  // e.g. Forms/Agreements/Communication) still lands on the correct tab —
  // it just has nothing to append after it.
  assert.equal(
    caseNotificationActionUrl("case-1", { type: "case_form.revision_updateavailable", category: "documents" }),
    "/app/cases/case-1?tab=forms",
  );
  assert.equal(
    caseNotificationActionUrl("case-1", { type: "case.updated", category: "cases" }),
    "/app/cases/case-1?tab=profile",
  );
});

test("staff and portal document uploads pass the real document id into case notification links", async () => {
  const [staffUpload, portalUpload] = await Promise.all([
    source("../src/controllers/clientDocumentController.js"),
    source("../src/controllers/portalController.js"),
  ]);

  assert.match(staffUpload, /entityType: "client_document",\s*entityId: data\.id,\s*action: existing \? "client_document\.file_replaced" : "client_document\.file_uploaded"/);
  assert.match(portalUpload, /entityType: "client_document",\s*entityId: existing\.id,\s*action: "client_document\.portal_uploaded"/);
});

test("sidebar badges mark attention but always open the normal section route", async () => {
  const sidebar = await source("../../frontend/src/components/layout/Sidebar.jsx");
  assert.match(sidebar, /to=\{item\.to\}/);
  assert.doesNotMatch(sidebar, /focusUrl|badge\?\.focus\?\.actionUrl/);
  assert.match(sidebar, /tabular-nums/);
  assert.doesNotMatch(sidebar, /animate-pulse|shadow-\[0_0_18px/);
  assert.match(sidebar, /acknowledgeDestination\(item\.badgeKey\)/);
});

test("staff, case, and client sidebars consume one aggregated destination count system", async () => {
  const [schema, migration, controller, routes, provider, staffSidebar, portalSidebar, portalBottom, caseTabs] = await Promise.all([
    source("../prisma/schema.prisma"),
    source("../prisma/migrations/20260805100000_notification_sidebar_destinations/migration.sql"),
    source("../src/controllers/notificationController.js"),
    source("../src/routes/notificationRoutes.js"),
    source("../../frontend/src/components/notifications/NotificationProvider.jsx"),
    source("../../frontend/src/components/layout/Sidebar.jsx"),
    source("../../frontend/src/components/client-portal/ClientPortalSidebar.jsx"),
    source("../../frontend/src/components/client-portal/ClientPortalBottomNav.jsx"),
    source("../../frontend/src/components/case-profile/CaseWorkspaceTabs.jsx"),
  ]);
  assert.match(schema, /destinationKey\s+String/);
  assert.match(migration, /destination_key/);
  assert.match(controller, /attentionLevel: "action_required", readAt: null/);
  assert.match(controller, /attentionLevel: "update", readAt: null/);
  assert.match(controller, /focusRows/);
  assert.match(routes, /sidebar-counts/);
  assert.match(provider, /getSidebarNotificationCounts/);
  assert.match(provider, /acknowledgeDestination/);
  assert.doesNotMatch(provider, /focusDestination|SidebarFocusNotice/);
  assert.doesNotMatch(provider, /getUnreadNotificationCount/);
  assert.match(staffSidebar, /UpdateBadge/);
  assert.doesNotMatch(staffSidebar, /focusDestination/);
  assert.match(staffSidebar, /badgeKey: "payments"/);
  assert.match(portalSidebar, /portalChat/);
  assert.doesNotMatch(portalSidebar, /animate-pulse|shadow-\[0_0_18px/);
  assert.match(portalBottom, /portalDocuments/);
  assert.doesNotMatch(portalBottom, /animate-pulse|shadow-\[0_0_16px/);
  assert.match(caseTabs, /caseTabCounts/);
  assert.match(caseTabs, /acknowledgeDestination/);
});

test("a client activating their portal account does not fire the admin-facing Settings notification", async () => {
  const [authController, notificationService] = await Promise.all([
    source("../src/controllers/authController.js"),
    source("../src/services/notificationService.js"),
  ]);
  assert.match(authController, /const isStaffMembership = membership\.role !== "client"/);
  assert.match(authController, /isStaffMembership \? "MEMBER_INVITATION_ACCEPTED" : "CLIENT_PORTAL_ACCOUNT_ACTIVATED"/);
  assert.doesNotMatch(notificationService, /"CLIENT_PORTAL_ACCOUNT_ACTIVATED"/);
});
