import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { dashboardScopes } from "../src/controllers/dashboardController.js";

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

test("my workload exposes actionable records and recovers from API errors", async () => {
  const [controller, page] = await Promise.all([
    source("../src/controllers/adminConsultantController.js"),
    source("../../frontend/src/pages/Workload.jsx"),
  ]);

  assert.match(controller, /activeCaseItems/);
  assert.match(controller, /pendingTaskItems/);
  assert.match(controller, /overdueTaskItems/);
  assert.match(controller, /documentReviewItems/);
  assert.match(controller, /consultantUserId: userId, status: "active"/);
  assert.match(page, /Unable to load your workload/);
  assert.match(page, /Try again/);
  assert.match(page, /to=\{`\/app\/cases\/\$\{item\.case\.id\}`\}/);
});
