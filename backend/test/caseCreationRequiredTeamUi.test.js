import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("new case creation collects and submits the required RCIC and Case Worker", async () => {
  const [page, routes, controller] = await Promise.all([
    read("../frontend/src/pages/Cases.jsx"),
    read("src/routes/caseRoutes.js"),
    read("src/controllers/caseTeamController.js"),
  ]);

  assert.match(page, /api\.get\("\/cases\/collaboration-options"\)/);
  assert.match(page, /name="rcicUserId"/);
  assert.match(page, /name="caseWorkerUserId"/);
  assert.match(page, /rcicUserId: formState\.rcicUserId/);
  assert.match(page, /caseWorkerUserId: formState\.caseWorkerUserId/);
  assert.match(page, /Choose both an RCIC and a Case Worker before creating the case/);
  assert.match(routes, /router\.get\("\/collaboration-options", asyncHandler\(getNewCaseCollaborationOptions\)\)/);
  assert.match(controller, /validateRequiredCaseTeam\(agencyId, req\.body \|\| \{\}\)/);
});
