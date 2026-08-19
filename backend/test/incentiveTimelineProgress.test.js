import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("projectCaseTimelineLegs re-derives history from ALL of a case's evaluations, not filtered by the current live legIds — legs are deleted-and-recreated whole on every plan save", async () => {
  const service = await source("../src/services/incentiveTimelineService.js");
  assert.match(service, /const evaluations = await prisma\.incentiveTimelineLegEvaluation\.findMany\(\{ where: \{ agencyId, caseId \} \}\);/);
  // No legId: { in: ... } filter on this query, unlike evaluateCaseTimelineLegs's own lookup.
  const fnStart = service.indexOf("export async function projectCaseTimelineLegs(");
  const fnBody = service.slice(fnStart, service.indexOf("\n}\n", fnStart));
  assert.doesNotMatch(fnBody, /legId: \{ in:/);
});

test("an evaluation whose legId no longer exists on the live plan is still surfaced as a RESOLVED entry, not dropped", async () => {
  const service = await source("../src/services/incentiveTimelineService.js");
  assert.match(service, /if \(consumedLegIds\.has\(evaluation\.legId\)\) continue;/);
  assert.match(service, /result\.push\(resolvedLegEntry\(evaluation, recipientsByEvaluationId\)\);/);
});

test("the projection never resolves toCheckpointType — display doesn't need it and it would cost a query per leg", async () => {
  const service = await source("../src/services/incentiveTimelineService.js");
  const fnStart = service.indexOf("export async function projectCaseTimelineLegs(");
  const fnBody = service.slice(fnStart, service.indexOf("\n}\n", fnStart));
  assert.doesNotMatch(fnBody, /leg\.toCheckpointType/);
  assert.match(fnBody, /resolveCheckpointTimestamp\(agencyId, caseId, leg\.fromCheckpointType, leg\.fromCheckpointValue\)/);
});

test("credited recipients are fetched in one batched query per case, only for CREDITED outcomes", async () => {
  const service = await source("../src/services/incentiveTimelineService.js");
  assert.match(service, /const creditedEvaluationIds = evaluations\.filter\(\(row\) => row\.outcome === "CREDITED"\)\.map\(\(row\) => row\.id\);/);
  assert.match(service, /timelineLegEvaluationId: \{ in: creditedEvaluationIds \}, entryType: "TIMELINE_BONUS" /);
});

test("estimateCaseTimelineProgress never throws — a missing case or missing plan returns an empty projection", async () => {
  const service = await source("../src/services/incentiveTimelineService.js");
  assert.match(service, /export async function estimateCaseTimelineProgress\(agencyId, caseId\) \{/);
  assert.match(service, /if \(!caseItem\) return \{ planId: null, planName: null, legs: \[\] \};/);
  assert.match(service, /const plan = await resolvePlan\(agencyId, caseItem\.caseType\);/);
});

test("the case-scoped timeline-progress route is read-only and already behind requireCaseAccess, matching /workflow and /ledger", async () => {
  const [routes, controller] = await Promise.all([
    source("../src/routes/caseRoutes.js"),
    source("../src/controllers/caseTimelineProgressController.js"),
  ]);
  assert.match(routes, /router\.get\("\/:id\/timeline-progress", asyncHandler\(getCaseTimelineProgress\)\);/);
  // Declared after router.use("/:id", requireCaseAccess()) with no extra role guard, same as /workflow.
  const useIndex = routes.indexOf('router.use("/:id", requireCaseAccess());');
  const routeIndex = routes.indexOf('router.get("/:id/timeline-progress"');
  assert.ok(useIndex !== -1 && routeIndex > useIndex);
  assert.match(controller, /export async function getCaseTimelineProgress\(req, res\) \{/);
  assert.match(controller, /estimateCaseTimelineProgress\(req\.auth\.agencyId, req\.params\.id\)/);
});
