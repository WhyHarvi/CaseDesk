import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("authorized staff can edit a case without leaving its case file", async () => {
  const [profile, summary] = await Promise.all([
    source("../../frontend/src/pages/CaseProfile.jsx"),
    source("../../frontend/src/components/case-profile/CaseProfileSummary.jsx"),
  ]);

  assert.match(summary, /label="Edit case"/);
  assert.match(summary, /onClick=\{onEditCase\}/);
  assert.match(profile, /showEditCase=\{canManageCase && !caseItem\.deletedAt\}/);
  assert.match(profile, /<CaseFormDrawer/);
  assert.match(profile, /await api\.patch\(`\/cases\/\$\{caseItem\.id\}`/);
  assert.match(profile, /setCaseItem\(\(current\) => \(\{ \.\.\.current, \.\.\.\(response\.data\.data \|\| response\.data\) \}\)\)/);
});
