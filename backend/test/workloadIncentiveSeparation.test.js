import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("incentive-only case roles never inflate Team Workload collaboration", async () => {
  const controller = await source("../src/controllers/adminConsultantController.js");
  assert.match(controller, /const countedCollaboratorIds = new Set\(\);/);
  assert.match(controller, /item\.assignments \|\| \[\]/);
  assert.doesNotMatch(controller, /item\.roleAssignments \|\| \[\]/);
  assert.doesNotMatch(controller, /roleAssignments: \{\s*where: \{ status: "active" \}/);
});

test("Frontdesk cannot be permanently assigned to a case", async () => {
  const [controller, retiredScript] = await Promise.all([
    source("../src/controllers/caseRoleAssignmentController.js"),
    source("../scripts/assign-frontdesk.js"),
  ]);
  assert.match(controller, /Frontdesk is attributed from the person who records each payment and cannot be assigned permanently to a case/);
  assert.match(retiredScript, /assign-frontdesk\.js is retired/);
  assert.doesNotMatch(retiredScript, /caseRoleAssignment\.upsert/);
});
