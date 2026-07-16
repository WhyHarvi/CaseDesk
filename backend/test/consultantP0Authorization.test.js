import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("appointments apply consultant case access to every read and mutation", async () => {
  const controller = await source("../src/controllers/appointmentController.js");
  assert.match(controller, /import \{ caseAccessWhere \}/);
  assert.match(controller, /where: \{ id: caseId, agencyId: req\.user\.agencyId, \.\.\.caseAccessWhere\(req\) \}/);
  assert.equal((controller.match(/case: caseAccessWhere\(req\)/g) || []).length, 2);
  assert.match(controller, /status: "active"/);
  assert.match(controller, /role: \{ in: \["admin", "consultant"\] \}/);
});

test("applicant reuse only enumerates cases accessible to the consultant", async () => {
  const controller = await source("../src/controllers/caseApplicantController.js");
  assert.match(controller, /const accessWhere = caseAccessWhere\(req\)/);
  assert.equal((controller.match(/where: \{[^\n]*agencyId, \.\.\.accessWhere \}/g) || []).length, 2);
  assert.match(controller, /const agencyCaseIds = new Set\(agencyCases\.map/);
});

test("follow-up writes validate accessible relations and active internal assignees", async () => {
  const [controller, routes] = await Promise.all([
    source("../src/controllers/followUpController.js"),
    source("../src/routes/followUpRoutes.js"),
  ]);
  assert.match(controller, /clientAccessWhere\(req\)/);
  assert.match(controller, /caseAccessWhere\(req\)/);
  assert.match(controller, /The selected case does not belong to the selected client/);
  assert.match(controller, /Assigned staff member was not found or is inactive/);
  assert.match(controller, /id: req\.params\.id,[\s\S]*\.\.\.relatedRecordAccessWhere\(req\)/);
  assert.doesNotMatch(routes, /error-demo/);
  assert.doesNotMatch(controller, /getFollowUpError/);
});

test("consultants can mutate only notes they authored", async () => {
  const [controller, overlay, card] = await Promise.all([
    source("../src/controllers/noteController.js"),
    source("../../frontend/src/components/case-profile/notes/NotesOverlay.jsx"),
    source("../../frontend/src/components/case-profile/notes/NoteCard.jsx"),
  ]);
  assert.match(controller, /note\.userId !== req\.auth\.userId/);
  assert.match(controller, /You can only change notes that you created/);
  assert.match(controller, /req\.body = \{ content \}/);
  assert.match(overlay, /role === "admin" \|\| note\.user\?\.id === appUser\?\.id/);
  assert.match(card, /canManage \?/);
});
