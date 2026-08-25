import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseWorkloadPeriod, WORKLOAD_PERIODS, workloadPeriodBounds } from "../src/modules/workload/workload.metrics.js";
import { recordPortalActivityPing } from "../src/modules/workload/workload.heartbeat.service.js";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("workload periods parse to a whitelisted rolling window, defaulting to week", () => {
  assert.equal(parseWorkloadPeriod("day"), "day");
  assert.equal(parseWorkloadPeriod("month"), "month");
  assert.equal(parseWorkloadPeriod("nonsense"), "week");
  assert.equal(parseWorkloadPeriod(undefined), "week");

  const now = new Date("2026-07-14T12:00:00Z");
  const day = workloadPeriodBounds("day", now);
  assert.equal(day.to.getTime(), now.getTime());
  assert.equal(now.getTime() - day.from.getTime(), WORKLOAD_PERIODS.day * 24 * 60 * 60_000);

  const month = workloadPeriodBounds("month", now);
  assert.equal(now.getTime() - month.from.getTime(), WORKLOAD_PERIODS.month * 24 * 60 * 60_000);
});

test("the portal-activity heartbeat is a single atomic upsert, capped so a missed ping can't inflate active time", async () => {
  let statement;
  const db = { $executeRaw: async (query) => { statement = query; return 1; } };
  const now = new Date("2026-07-14T12:00:00Z");

  await recordPortalActivityPing({ agencyId: "agency-1", userId: "user-1" }, now, db);

  assert.match(statement.text, /INSERT INTO "user_portal_activity"/);
  assert.match(statement.text, /ON CONFLICT \(agency_id, user_id, activity_date\) DO UPDATE SET/);
  assert.match(statement.text, /active_seconds = "user_portal_activity"\.active_seconds/);
  assert.match(statement.text, /LEAST\(GREATEST\(EXTRACT\(EPOCH FROM/);
  assert.ok(statement.values.includes("agency-1"));
  assert.ok(statement.values.includes("user-1"));
  // The 150s cap (~2.5x the frontend's 60s ping interval) bounding how much
  // a single missed/late ping can inflate active time.
  assert.ok(statement.values.includes(150));
});

test("the team workload report reuses loadAgencyWorkloads for case counts/capacity instead of re-deriving ownership", async () => {
  const service = await source("../src/modules/workload/workload.report.service.js");
  assert.match(service, /import \{ loadAgencyWorkloads \} from "\.\.\/\.\.\/controllers\/adminConsultantController\.js";/);
  assert.match(service, /loadAgencyWorkloads\(agencyId\)/);
  assert.match(service, /deadlinesOverdue: member\.overdueTasks \+ member\.overdueFollowUps/);
});

test("the team workload report's raw SQL scopes to active staff and the settled Posted+Payment cash signal", async () => {
  const service = await source("../src/modules/workload/workload.report.service.js");
  // Same active-staff scoping the leads reports already use (getEmployeeReport,
  // getWorkloadReport) — admin/consultant/frontdesk, active membership, active user.
  assert.match(service, /m\.role::text IN \('admin', 'consultant', 'frontdesk'\)/);
  assert.match(service, /u\.status::text = 'active'/);
  // Posted + Payment only — narrower than paymentsOverviewService.js's
  // getCashOnHand/cashDayTotals convention (which counts all Posted
  // movement including refunds) since "collected" shouldn't include money
  // going back out.
  assert.match(service, /ct\."status" = 'Posted' AND ct\."type" = 'Payment'/);
  assert.match(service, /"ooma_call_sessions" oc/);
  assert.match(service, /"appointments" ap/);
  assert.match(service, /"user_portal_activity" pa/);
  // Deadlines due-soon spans all three assignable deadline sources.
  assert.match(service, /"follow_ups" f/);
  assert.match(service, /"lead_follow_ups" lf/);
  assert.match(service, /"case_workflow_steps" cws/);
});

test("the workload routes expose the heartbeat to any staff member and the team report to admins or the teamWorkload capability", async () => {
  const [routes, server, portalAccessService] = await Promise.all([
    source("../src/modules/workload/workload.routes.js"),
    source("../src/server.js"),
    source("../src/services/portalAccessService.js"),
  ]);
  assert.match(routes, /router\.post\("\/activity-ping", asyncHandler\(pingPortalActivity\)\)/);
  assert.match(routes, /router\.get\("\/team", requirePortalCapability\("teamWorkload"\), asyncHandler\(getTeamWorkload\)\)/);
  assert.match(routes, /router\.get\("\/team\/daily-trend", requirePortalCapability\("teamWorkload"\), asyncHandler\(getDailyTrend\)\)/);
  assert.match(server, /app\.use\("\/api\/workload", requireAuth, staffUser, workloadRoutes\)/);
  // requirePortalCapability auto-passes for admins (defaultPortalAccess
  // grants every capability), so this is additive — it lets a specific
  // staff member be granted the same team-wide view without becoming an
  // admin, without changing admin access at all.
  assert.match(portalAccessService, /"teamWorkload"/);
  assert.match(portalAccessService, /export function hasPortalCapability\(req, capability\)/);
  assert.match(portalAccessService, /req\.auth\?\.role === "admin" \|\|/);
});

test("the frontend heartbeat hook pings while visible/active and the workload page fetches the new team endpoint", async () => {
  const [hook, layout, page, queryClient] = await Promise.all([
    source("../../frontend/src/hooks/usePortalHeartbeat.js"),
    source("../../frontend/src/layouts/MainLayout.jsx"),
    source("../../frontend/src/pages/Workload.jsx"),
    source("../../frontend/src/services/queryClient.js"),
  ]);
  assert.match(hook, /api\.post\("\/workload\/activity-ping"\)/);
  assert.match(hook, /if \(document\.visibilityState === "hidden"\) return;/);
  assert.match(hook, /if \(Date\.now\(\) - lastActivityAt\.current > IDLE_THRESHOLD_MS\) return;/);
  assert.match(layout, /import usePortalHeartbeat from "\.\.\/hooks\/usePortalHeartbeat";/);
  assert.match(layout, /usePortalHeartbeat\(\);/);
  assert.match(page, /`\/workload\/team\?period=\$\{period\}`/);
  // Without this, the once-a-minute heartbeat would invalidate every
  // cached query in the app (queryClient.js's "no related list" fallback).
  assert.match(queryClient, /workload: \[\]/);
});
