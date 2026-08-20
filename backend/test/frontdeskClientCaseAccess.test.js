import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { defaultPortalAccess, normalizePortalAccess } from "../src/services/portalAccessService.js";
import { caseAccessWhere, clientAccessWhere } from "../src/middleware/authorization.js";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("frontdesk defaults to full view access on clients and cases", () => {
  const frontdesk = defaultPortalAccess("frontdesk");
  assert.equal(frontdesk.pages.clients, true);
  assert.equal(frontdesk.pages.cases, true);
  assert.equal(frontdesk.data.clients, "all");
  assert.equal(frontdesk.data.cases, "all");
  // Only the case profile tab is on — documents, billing, forms, tasks,
  // agreements/letters, communication, and questionnaires stay off, so
  // frontdesk's case view is the summary, not full case management.
  assert.equal(frontdesk.caseTabs.profile, true);
  for (const tab of ["documents", "billing", "forms", "tasks", "agreementsLetters", "communication", "questionnaires"]) {
    assert.equal(frontdesk.caseTabs[tab], false, `expected caseTabs.${tab} to stay false`);
  }
  // "all" scope means no additional row-level filtering — an empty where
  // clause, same as admin, not scoped to "assigned to me".
  const req = { auth: { role: "frontdesk", userId: "frontdesk-1", permissions: { portalAccess: frontdesk } } };
  assert.deepEqual(clientAccessWhere(req), {});
  assert.deepEqual(caseAccessWhere(req), {});
});

test("an invalid saved data scope for frontdesk falls back to the new all-access default, not the old none", () => {
  const access = normalizePortalAccess("frontdesk", { data: { clients: "nonsense", cases: "nonsense" } });
  assert.equal(access.data.clients, "all");
  assert.equal(access.data.cases, "all");
});

test("client write endpoints (update/archive/close) are open to admin/consultant/frontdesk — creating a client stays open for front-desk intake", async () => {
  const routes = await source("../src/routes/clientRoutes.js");

  // The front-desk walk-in intake flow (Clients.jsx) posts here directly —
  // this must never gain a role guard or that flow breaks.
  assert.match(routes, /router\.post\("\/", asyncHandler\(createClient\)\);/);

  assert.match(routes, /router\.patch\("\/:id", requireRole\("admin", "consultant", "frontdesk"\), asyncHandler\(updateClient\)\);/);
  assert.match(routes, /router\.patch\("\/:id\/archive", requireRole\("admin", "consultant", "frontdesk"\), asyncHandler\(archiveClient\)\);/);
  assert.match(routes, /router\.patch\("\/:id\/close", requireRole\("admin", "consultant", "frontdesk"\), asyncHandler\(closeClient\)\);/);
});

test("case write endpoints (update/lifecycle/applicants/workflow/ledger) are admin/consultant only — creating a case stays open for front-desk intake", async () => {
  const routes = await source("../src/routes/caseRoutes.js");

  // The front-desk "professional payment" flow (Cases.jsx, after client
  // creation) posts here directly — this must never gain a role guard.
  // createCaseWithRequiredCollaboration wraps createCase to also confirm
  // the required RCIC/Case Worker team, but adds no role restriction.
  assert.match(routes, /router\.post\("\/", asyncHandler\(createCaseWithRequiredCollaboration\)\);/);

  for (const pattern of [
    /router\.post\("\/:id\/applicants", requireRole\("admin", "consultant"\), asyncHandler\(createCaseApplicant\)\);/,
    /router\.patch\("\/:id\/applicants\/:applicantId", requireRole\("admin", "consultant"\), asyncHandler\(updateCaseApplicant\)\);/,
    /requireRole\("admin", "consultant"\),\n  asyncHandler\(removeCaseApplicant\),/,
    /requirePortalCaseTab\("profile"\),\n  requireRole\("admin", "consultant"\),\n  asyncHandler\(saveCaseAssessment\),/,
    /router\.post\(\n  "\/:id\/workflow\/apply-template",\n  requireRole\("admin", "consultant"\),/,
    /router\.patch\("\/:id\/workflow", requireRole\("admin", "consultant"\), asyncHandler\(saveCaseWorkflow\)\);/,
    /router\.patch\("\/:id\/workflow\/:stepId", requireRole\("admin", "consultant"\), asyncHandler\(updateCaseWorkflowStep\)\);/,
    /router\.post\("\/:id\/ledger", requireRole\("admin", "consultant"\), asyncHandler\(createCaseLedgerEntry\)\);/,
    /router\.patch\("\/:id\/ledger\/:entryId", requireRole\("admin", "consultant"\), asyncHandler\(updateLedgerEntry\)\);/,
    /router\.delete\("\/:id\/ledger\/:entryId", requireRole\("admin", "consultant"\), asyncHandler\(deleteLedgerEntry\)\);/,
    // updateCase/closeCase are now wrapped: updateCaseWithRequiredCollaboration
    // reuses updateCase's own logic, and both /lifecycle and /close additionally
    // gate on requireCompleteCaseTeam — an existing case can't move through its
    // lifecycle without a confirmed RCIC and Case Worker.
    /router\.patch\("\/:id", requireRole\("admin", "consultant"\), asyncHandler\(updateCaseWithRequiredCollaboration\)\);/,
    /router\.patch\(\n {2}"\/:id\/close",\n {2}requireRole\("admin", "consultant"\),\n {2}asyncHandler\(requireCompleteCaseTeam\),\n {2}asyncHandler\(closeCase\),\n\);/,
    /router\.patch\("\/:id\/archive", requireRole\("admin", "consultant"\), asyncHandler\(archiveCase\)\);/,
    /router\.patch\("\/:id\/unarchive", requireRole\("admin", "consultant"\), asyncHandler\(unarchiveCase\)\);/,
    /router\.delete\("\/:id", requireRole\("admin", "consultant"\), asyncHandler\(softDeleteCase\)\);/,
    /router\.patch\("\/:id\/restore", requireRole\("admin", "consultant"\), asyncHandler\(restoreCase\)\);/,
  ]) {
    assert.match(routes, pattern);
  }

  // Reads stay open — applicants, workflow, and ledger are still viewable.
  assert.match(routes, /router\.get\("\/:id\/applicants", asyncHandler\(listCaseApplicants\)\);/);
  assert.match(routes, /router\.get\("\/:id\/workflow", asyncHandler\(getCaseWorkflow\)\);/);
  assert.match(routes, /router\.get\("\/:id\/ledger", asyncHandler\(listCaseLedgerEntries\)\);/);
});

test("notes require the internalNotes capability, not just client/case data access", async () => {
  const routes = await source("../src/routes/noteRoutes.js");
  assert.match(routes, /router\.use\(requireRole\("admin", "consultant", "frontdesk"\)\);/);
  assert.match(routes, /router\.use\(requirePortalCapability\("internalNotes"\)\);/);
});

test("Clients.jsx and ClientProfile.jsx show edit/archive actions to admin/consultant/frontdesk, hidden only for genuinely view-only visitors", async () => {
  const [listPage, profilePage] = await Promise.all([
    source("../../frontend/src/pages/Clients.jsx"),
    source("../../frontend/src/pages/ClientProfile.jsx"),
  ]);
  assert.match(listPage, /const canManageClients = \["admin", "consultant", "frontdesk"\]\.includes\(role\);/);
  assert.match(listPage, /if \(!canManage\) return null;/);
  assert.match(listPage, /canManage=\{canManageClients\}/);
  assert.match(profilePage, /\{\["admin", "consultant", "frontdesk"\]\.includes\(role\) \? \(\s*<button\s*type="button"\s*onClick=\{\(\) => setEditingClient\(true\)\}/);
});

test("Cases.jsx and CaseProfile.jsx hide edit/lifecycle actions from view-only visitors", async () => {
  const [listPage, profilePage, summary] = await Promise.all([
    source("../../frontend/src/pages/Cases.jsx"),
    source("../../frontend/src/pages/CaseProfile.jsx"),
    source("../../frontend/src/components/case-profile/CaseProfileSummary.jsx"),
  ]);
  assert.match(listPage, /const canManageCases = \["admin", "consultant"\]\.includes\(role\);/);
  assert.match(listPage, /disabled=\{!canManageCases \|\| registerView !== "active"\}/);
  assert.match(listPage, /if \(!canManage\) return null;/);
  assert.match(profilePage, /const canManageCase = \["admin", "consultant"\]\.includes\(role\);/);
  assert.match(profilePage, /canManageCase=\{canManageCase\}/);
  assert.match(profilePage, /showEditClient=\{canManageCase\}/);
  assert.match(summary, /canManageCase \|\| !\["Applicants", "Archive", "Delete", "Close"\]\.includes\(item\)/);
});
