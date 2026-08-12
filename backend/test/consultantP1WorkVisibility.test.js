import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolveWorkOwner } from "../src/controllers/adminConsultantController.js";
import {
  DASHBOARD_FINANCIAL_ACTIVITY_ACTIONS,
  DASHBOARD_HIDDEN_ACTIVITY_ACTIONS,
  canViewDashboardFinancialData,
  dashboardScopes,
} from "../src/controllers/dashboardController.js";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");
const request = (role, userId = "consultant-1", agencyId = "agency-1") => ({
  auth: { role, userId, agencyId },
});

test("consultant dashboard queues remain agency and assignment scoped", () => {
  const scopes = dashboardScopes(request("consultant"));
  const serialized = JSON.stringify(scopes);

  assert.match(serialized, /agency-1/);
  assert.match(serialized, /consultant-1/);
  assert.match(JSON.stringify(scopes.caseWhere), /assignedUserId|assignments/);
  assert.match(JSON.stringify(scopes.taskWhere), /assignedToId/);
  assert.match(JSON.stringify(scopes.appointmentWhere), /"case"/);
  assert.match(JSON.stringify(scopes.documentWhere), /"case"/);
  assert.match(JSON.stringify(scopes.activityWhere), /"client"/);
  assert.doesNotMatch(serialized, /consultant-2|agency-2/);
});

test("admin dashboard queues are still constrained to the active agency", () => {
  const scopes = dashboardScopes(request("admin", "admin-1"));
  for (const scope of Object.values(scopes)) assert.equal(scope.agencyId, "agency-1");
});

test("dashboard financial data follows the team member portal-access capability", async () => {
  const restricted = request("consultant");
  restricted.auth.permissions = {
    portalAccess: { capabilities: { financialData: false } },
  };
  const allowed = request("consultant");
  allowed.auth.permissions = {
    portalAccess: { capabilities: { financialData: true } },
  };

  assert.equal(canViewDashboardFinancialData(restricted), false);
  assert.equal(canViewDashboardFinancialData(allowed), true);
  assert.equal(canViewDashboardFinancialData(request("admin", "admin-1")), true);
  assert.ok(DASHBOARD_FINANCIAL_ACTIVITY_ACTIONS.includes("invoice.paid"));

  const controller = await source("../src/controllers/dashboardController.js");
  assert.match(controller, /canViewFinancialData\s*\? prisma\.payment\.count/);
  assert.match(controller, /canViewFinancialData\s*\? prisma\.caseInvoice\.count/);
  assert.match(controller, /canViewFinancialData\s*\? prisma\.bookingPaymentHold\.count/);
  assert.match(controller, /\.\.\.\(canViewFinancialData[\s\S]*pendingPaymentBalance/);
});

test("dashboard renders API work queues instead of placeholder arrays and inert actions", async () => {
  const [page, stats, workRow, bottomRow, controller] = await Promise.all([
    source("../../frontend/src/pages/Dashboard.jsx"),
    source("../../frontend/src/components/dashboard/DashboardStats.jsx"),
    source("../../frontend/src/components/dashboard/DashboardWorkRow.jsx"),
    source("../../frontend/src/components/dashboard/DashboardBottomRow.jsx"),
    source("../src/controllers/dashboardController.js"),
  ]);

  assert.match(page, /DashboardWorkRow dashboard=\{dashboard\} loading=\{loading\}/);
  assert.match(page, /DashboardBottomRow dashboard=\{dashboard\} loading=\{loading\}/);
  assert.doesNotMatch(workRow, /const appointments = \[\]|const todayWork = \[\]|const pipelineStages = \[\]/);
  assert.doesNotMatch(bottomRow, /const followUps = \[\]|const activityItems = \[\]/);
  assert.match(workRow, /dashboard\?\.upcomingAppointments/);
  assert.match(bottomRow, /dashboard\?\.recentActivity/);
  assert.match(stats, /dashboard\.stats\.pendingDocuments/);
  assert.match(stats, /dashboard\.stats\.tasksDueToday/);
  assert.match(controller, /reportingBounds\(now, timezone\)/);
  assert.match(controller, /AND: \[[\s\S]*caseAccessWhere\(req\)/);
});

test("dashboard recent activity hides session authentication noise", async () => {
  const controller = await source("../src/controllers/dashboardController.js");

  assert.deepEqual(DASHBOARD_HIDDEN_ACTIVITY_ACTIONS, ["USER_LOGIN", "USER_LOGOUT"]);
  assert.match(
    controller,
    /notIn: canViewFinancialData[\s\S]*DASHBOARD_HIDDEN_ACTIVITY_ACTIONS[\s\S]*DASHBOARD_FINANCIAL_ACTIVITY_ACTIONS/,
  );
});

test("my workload exposes actionable records and recovers from API errors", async () => {
  const [controller, page] = await Promise.all([
    source("../src/controllers/adminConsultantController.js"),
    source("../../frontend/src/pages/Workload.jsx"),
  ]);

  assert.match(controller, /activeCaseItems/);
  assert.match(controller, /activeLeadItems/);
  assert.match(controller, /overdueLeadActions/);
  assert.match(controller, /pendingTaskItems/);
  assert.match(controller, /overdueTaskItems/);
  assert.match(controller, /documentReviewItems/);
  assert.match(controller, /caseOwnerRole === "frontdesk" \? "front_desk" : "case_owner"/);
  assert.match(controller, /source: "case_assignment"/);
  assert.match(controller, /assignmentSource: owner\.source/);
  assert.match(page, /Unable to load your workload/);
  assert.match(page, /Try again/);
  assert.match(page, /`\/app\/cases\/\$\{item\.case\.id\}\?tab=tasks&highlight=/);
});

test("admin workload shows agency consultants, assignments, and unassigned work", async () => {
  const [controller, routes, page, rosterTable, dashboard, sidebar, tasksWorkspace] = await Promise.all([
    source("../src/controllers/adminConsultantController.js"),
    source("../src/routes/adminRoutes.js"),
    source("../../frontend/src/pages/Workload.jsx"),
    source("../../frontend/src/components/workload/TeamRosterTable.jsx"),
    source("../../frontend/src/components/dashboard/DashboardWorkRow.jsx"),
    source("../../frontend/src/components/layout/Sidebar.jsx"),
    source("../../frontend/src/components/case-profile/TasksWorkspace.jsx"),
  ]);

  assert.match(routes, /router\.get\("\/consultants\/workload", asyncHandler\(agencyWorkloads\)\)/);
  assert.match(controller, /return \{[\s\S]*summary,[\s\S]*consultants,[\s\S]*unassigned,?[\s\S]*\}/);
  assert.doesNotMatch(controller, /outsideTeam: finalizeBucket|frontDesk: finalizeBucket/);
  // The roster now covers every active staff role, not just consultants —
  // this is the fix for admin-owned work landing in a real per-person
  // bucket instead of the old "outside the consultant roster" catch-all.
  assert.match(controller, /role: \{ in: \["admin", "consultant", "frontdesk"\] \}/);
  assert.match(controller, /status: \{ in: OPEN_CASE_STATUSES \}/);
  assert.match(controller, /pendingFollowUps: followUps\.length/);
  assert.match(controller, /activeLeads: leads\.length/);
  assert.match(controller, /status: \{ in: \["OPEN", "NURTURE"\] \}/);
  assert.match(controller, /upcomingAppointments: appointments\.length/);
  assert.match(controller, /activeCases: cases\.length/);
  // Admins get the new team activity report; the personal per-consultant
  // view (out of scope for this redesign) is unchanged.
  assert.match(page, /isAdmin \? `\/workload\/team\?period=\$\{period\}` : "\/consultants\/me\/workload"/);
  assert.match(page, /title=\{isAdmin \? "Team Workload" : "My Workload"\}/);
  assert.match(page, /Unassigned work needs an owner/);
  assert.match(rosterTable, /Your team/);
  assert.match(page, /Open Leads/);
  assert.match(page, /Overdue lead actions/);
  assert.match(dashboard, /isAdmin \? "View team workload" : "View all my work"/);
  assert.match(sidebar, /label: "Team Workload"/);
  assert.match(tasksWorkspace, /\$\{caseItem\.assignedUser\.fullName\} \(case owner\)/);
});

test("work ownership inherits from the active case consultant before becoming unassigned", () => {
  const agencyId = "agency-1";
  const membership = (role = "consultant", isActive = true) => [{ agencyId, role, isActive }];
  const consultant = { id: "consultant-1", status: "active", memberships: membership() };
  const admin = { id: "admin-1", status: "active", memberships: membership("admin") };
  const inactive = { id: "inactive-1", status: "disabled", memberships: membership() };
  const activeConsultantIds = new Set([consultant.id]);

  assert.deepEqual(resolveWorkOwner({ agencyId, activeConsultantIds, caseItem: { assignedUser: consultant, assignments: [] } }), {
    consultantId: consultant.id,
    source: "case_owner",
  });
  // An admin explicitly assigned but absent from the roster set passed in
  // here falls back to unassigned — in production this activeConsultantIds
  // set now always includes every active admin/consultant/frontdesk member,
  // so this only exercises the defensive fallback path, not a real scenario.
  assert.deepEqual(resolveWorkOwner({ agencyId, activeConsultantIds, explicitUser: admin, caseItem: { assignedUser: consultant, assignments: [] } }), {
    consultantId: null,
    source: "unassigned",
  });
  assert.deepEqual(resolveWorkOwner({ agencyId, activeConsultantIds, explicitUser: inactive, caseItem: { assignedUser: null, assignments: [{ assignmentType: "primary", consultant }] } }), {
    consultantId: consultant.id,
    source: "case_assignment",
  });
  assert.deepEqual(resolveWorkOwner({ agencyId, activeConsultantIds, caseItem: { assignedUser: null, assignments: [] } }), {
    consultantId: null,
    source: "unassigned",
  });
});

test("front desk staff resolve to their own roster slot, not a shared bucket, once they're in the active roster set", () => {
  const agencyId = "agency-1";
  const membership = (role, isActive = true) => [{ agencyId, role, isActive }];
  const frontDeskUser = { id: "frontdesk-1", status: "active", memberships: membership("frontdesk") };
  const activeConsultantIds = new Set([frontDeskUser.id]);

  assert.deepEqual(resolveWorkOwner({ agencyId, activeConsultantIds, explicitUser: frontDeskUser }), {
    consultantId: frontDeskUser.id,
    source: "front_desk",
  });
  assert.deepEqual(resolveWorkOwner({ agencyId, activeConsultantIds, caseItem: { assignedUser: frontDeskUser, assignments: [] } }), {
    consultantId: frontDeskUser.id,
    source: "front_desk",
  });
});
