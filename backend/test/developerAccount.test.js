import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("developer access is isolated behind its own role, route, and aggregate endpoint", async () => {
  const [schema, auth, server, controller, routes, dashboard] = await Promise.all([
    source("../prisma/schema.prisma"),
    source("../src/middleware/authMiddleware.js"),
    source("../src/server.js"),
    source("../src/controllers/developerController.js"),
    source("../../frontend/src/routes/AppRoutes.jsx"),
    source("../../frontend/src/pages/DeveloperDashboard.jsx"),
  ]);
  assert.match(schema, /enum UserRole \{\s+developer/);
  assert.match(auth, /"developer", "admin", "consultant"/);
  assert.match(server, /"\/api\/developer", requireAuth, requireRole\("developer"\)/);
  assert.match(controller, /slug: \{ not: "casedesk-developer" \}/);
  assert.doesNotMatch(controller, /fullName|email|caseType|description/);
  assert.match(routes, /path="\/developer"/);
  assert.match(dashboard, /Aggregate platform telemetry only/);
});

test("developer provisioning keeps credentials out of source and replaces matching identities", async () => {
  const script = await source("../scripts/provision-developer-account.js");
  assert.match(script, /process\.env\.DEVELOPER_PASSWORD/);
  assert.match(script, /prisma\.user\.delete/);
  assert.match(script, /\/auth\/v1\/admin\/users\/\$\{user\.id\}/);
  assert.match(script, /role: "developer"/);
  assert.doesNotMatch(script, /1@SidhuHarvi/);
});
