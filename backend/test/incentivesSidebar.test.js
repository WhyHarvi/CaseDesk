import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("the incentives portal page exists on both the backend and frontend allowlists, and defaults on for consultant/frontdesk", async () => {
  const [backendAccess, frontendAccess] = await Promise.all([
    source("../src/services/portalAccessService.js"),
    source("../../frontend/src/auth/portalAccess.js"),
  ]);
  for (const [name, src] of [["backend", backendAccess], ["frontend", frontendAccess]]) {
    assert.match(src, /"caseEasyImport",\s*\n\s*"incentives",/, `${name} portalPageKeys must list "incentives"`);
    assert.match(src, /caseEasyImport: true,\s*\n\s*incentives: true,/, `${name} frontdesk default must include incentives: true`);
  }
  // Admins get every page key automatically via allTrue/all(portalPageKeys, true)
  // — no per-key admin default needed, unlike frontdesk/consultant.
});

test("the two incentive-admin routers (case roles picker aside, plans + read APIs) require the incentives page, and incentive-plans stays admin-only underneath it", async () => {
  const [server, planRoutes] = await Promise.all([
    source("../src/server.js"),
    source("../src/routes/incentivePlanRoutes.js"),
  ]);
  assert.match(server, /app\.use\(\s*"\/api\/incentive-plans",\s*requireAuth,\s*staffUser,[\s\S]*?requirePortalPage\("incentives"\),\s*incentivePlanRoutes,\s*\);/);
  assert.match(server, /app\.use\(\s*"\/api\/incentives",\s*requireAuth,\s*staffUser,[\s\S]*?requirePortalPage\("incentives"\),\s*incentiveRoutes,\s*\);/);
  assert.match(planRoutes, /router\.use\(requireRole\("admin"\)\);/);
});

test("the sidebar exposes an Incentives entry to both admins and gated members, and the route is registered", async () => {
  const [sidebar, appRoutes] = await Promise.all([
    source("../../frontend/src/components/layout/Sidebar.jsx"),
    source("../../frontend/src/routes/AppRoutes.jsx"),
  ]);
  assert.match(sidebar, /label: "Incentives",\s*\n\s*to: "\/app\/incentives",\s*\n\s*icon: HandCoins,/);
  // The member-nav entry must be accessKey-gated like every other page, not
  // unconditionally visible to non-admin roles.
  assert.match(sidebar, /label: "Incentives",\s*\n\s*to: "\/app\/incentives",\s*\n\s*icon: HandCoins,\s*\n\s*accessKey: "incentives",/);
  assert.match(appRoutes, /path="\/app\/incentives"\s*\n\s*element=\{\s*\n\s*<Access page="incentives">\s*\n\s*<Incentives \/>/);
});

test("the Incentives page never lets a non-admin escape their own numbers, and labels the pipeline as an estimate", async () => {
  const page = await source("../../frontend/src/pages/Incentives.jsx");
  // Non-admins always render PersonView with their own id — there is no
  // code path where a consultant/frontdesk can pass another userId.
  assert.match(page, /<PersonView userId=\{appUser\?\.id\} \/>/);
  assert.match(page, /Potential — not guaranteed/);
  assert.match(page, /isAdmin \? \(\s*<Link to="\/app\/settings\?section=incentive-plans"/);
});
