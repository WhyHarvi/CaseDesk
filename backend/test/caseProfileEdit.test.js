import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("authorized staff can edit a case without leaving its case file", async () => {
  const [profile, summary, casesPage] = await Promise.all([
    source("../../frontend/src/pages/CaseProfile.jsx"),
    source("../../frontend/src/components/case-profile/CaseProfileSummary.jsx"),
    source("../../frontend/src/pages/Cases.jsx"),
  ]);

  assert.match(summary, /label="Edit case"/);
  assert.match(summary, /onClick=\{onEditCase\}/);
  assert.match(profile, /actions=\{[\s\S]*?onClick=\{openCaseEditor\}[\s\S]*?Edit case[\s\S]*?setEditingClient\(true\)[\s\S]*?Edit client[\s\S]*?Client profile/);
  assert.match(profile, /showEditCase=\{false\}/);
  assert.match(profile, /showEditClient=\{false\}/);
  assert.match(profile, /<CaseFormDrawer/);
  assert.match(profile, /onManageCaseTeam=\{\(\) => setCaseRolesOverlayOpen\(true\)\}/);
  assert.match(casesPage, /RCIC, Case Worker, collaborators, and additional roles are managed together/);
  assert.match(casesPage, /caseTeam\.rcic\?\.fullName \|\| "Unassigned"/);
  assert.match(casesPage, /caseTeam\.caseWorker\?\.fullName \|\| "Unassigned"/);
  assert.match(casesPage, /delete payload\.assignedUserId;/);
  const profileSave = profile.slice(profile.indexOf("async function saveCaseEdit"), profile.indexOf("async function contactClient"));
  assert.doesNotMatch(profileSave, /assignedUserId:/);
  assert.match(profile, /await api\.patch\(`\/cases\/\$\{caseItem\.id\}`/);
  assert.match(profile, /setCaseItem\(\(current\) => \(\{ \.\.\.current, \.\.\.\(response\.data\.data \|\| response\.data\) \}\)\)/);
});
