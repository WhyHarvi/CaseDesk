import assert from "node:assert/strict";
import test from "node:test";
import {
  clearDashboardCache,
  dashboardCacheKey,
  getCachedDashboard,
  invalidateDashboardCache,
  setCachedDashboard,
} from "../src/services/dashboardCache.js";

test("dashboard cache keys isolate agency, user, and role", () => {
  assert.notEqual(
    dashboardCacheKey({ agencyId: "agency-a", userId: "user-a", role: "admin" }),
    dashboardCacheKey({ agencyId: "agency-a", userId: "user-b", role: "admin" }),
  );
  assert.notEqual(
    dashboardCacheKey({ agencyId: "agency-a", userId: "user-a", role: "admin" }),
    dashboardCacheKey({ agencyId: "agency-b", userId: "user-a", role: "admin" }),
  );
});

test("dashboard cache returns live entries and drops expired entries", () => {
  clearDashboardCache();
  const key = "agency-a:user-a:admin";
  setCachedDashboard(key, { stats: { openCases: 4 } }, 1_000);
  assert.deepEqual(getCachedDashboard(key, 2_000), { stats: { openCases: 4 } });
  assert.equal(getCachedDashboard(key, 1_000 + 6 * 60_000), null);
});

test("dashboard cache invalidation affects only the changed agency", () => {
  clearDashboardCache();
  setCachedDashboard("agency-a:user-a:admin", { agency: "a" }, 1_000);
  setCachedDashboard("agency-b:user-b:admin", { agency: "b" }, 1_000);
  invalidateDashboardCache("agency-a");
  assert.equal(getCachedDashboard("agency-a:user-a:admin", 2_000), null);
  assert.deepEqual(getCachedDashboard("agency-b:user-b:admin", 2_000), { agency: "b" });
  clearDashboardCache();
});
