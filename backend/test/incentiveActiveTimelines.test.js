import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("the active-timelines aggregate is scoped the same way getPipeline is — self unless admin passes ?userId=", async () => {
  const controller = await source("../src/controllers/incentiveLedgerController.js");
  const fnStart = controller.indexOf("export async function getActiveTimelines(");
  const fnBody = controller.slice(fnStart, controller.indexOf("\n}\n", fnStart));
  assert.match(fnBody, /const userId = targetUserId\(req\);/);
  assert.match(fnBody, /if \(!userId\) return res\.json\(\{ data: \[\] \}\);/);
});

test("the candidate-case pre-filter unions case-team membership with lead-derived attribution, bounded to this agency and never archived/deleted", async () => {
  const controller = await source("../src/controllers/incentiveLedgerController.js");
  const fnStart = controller.indexOf("export async function getActiveTimelines(");
  const fnBody = controller.slice(fnStart, controller.indexOf("\n}\n", fnStart));

  assert.match(fnBody, /prisma\.lead\.findMany\(\{ where: \{ agencyId, ownerUserId: userId, convertedCaseId: \{ not: null \} \}/);
  assert.match(fnBody, /prisma\.leadConversion\.findMany\(\{ where: \{ agencyId, convertedById: userId, caseId: \{ not: null \} \}/);

  assert.match(fnBody, /agencyId,\s*\n\s*archivedAt: null,\s*\n\s*deletedAt: null,/);
  assert.match(fnBody, /\{ assignedUserId: userId \}/);
  assert.match(fnBody, /\{ assignments: \{ some: \{ consultantUserId: userId, status: "active" \} \} \}/);
  assert.match(fnBody, /\{ roleAssignments: \{ some: \{ userId, status: "active" \} \} \}/);
  assert.match(fnBody, /leadDerivedCaseIds\.length \? \[\{ id: \{ in: leadDerivedCaseIds \} \}\] : \[\]/);
});

test("plan/legs are resolved once per distinct caseType — not once per case — before any per-case work runs", async () => {
  const controller = await source("../src/controllers/incentiveLedgerController.js");
  const fnStart = controller.indexOf("export async function getActiveTimelines(");
  const fnBody = controller.slice(fnStart, controller.indexOf("\n}\n", fnStart));
  assert.match(fnBody, /for \(const caseType of new Set\(candidateCases\.map\(\(row\) => row\.caseType\)\)\) \{/);
  assert.match(fnBody, /if \(!legsByPlanId\.has\(plan\.id\)\) legsByPlanId\.set\(plan\.id, await fetchPlanTimelineLegs\(plan\.id\)\);/);
});

test("holder confirmation reuses computeSplits with a large nominal pool, not a re-derivation of attribution logic, and the view is filtered to non-resolved legs only", async () => {
  const controller = await source("../src/controllers/incentiveLedgerController.js");
  const fnStart = controller.indexOf("export async function getActiveTimelines(");
  const fnBody = controller.slice(fnStart, controller.indexOf("\n}\n", fnStart));
  assert.match(fnBody, /const splits = computeSplits\(resolved\.plan, 10000, holders\);/);
  assert.match(fnBody, /if \(!splits\.some\(\(entry\) => entry\.userId === userId\)\) continue;/);
  assert.match(fnBody, /\.filter\(\(leg\) => leg\.state !== "RESOLVED"\)/);
});

test("the /incentives/timelines route is wired and mounted the same way /pipeline is", async () => {
  const routes = await source("../src/routes/incentiveRoutes.js");
  assert.match(routes, /router\.get\("\/timelines", asyncHandler\(getActiveTimelines\)\);/);
});
