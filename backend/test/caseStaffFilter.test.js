import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("the Cases staff filter includes RCICs and Case Workers and matches either role", async () => {
  const [casesPage, commandBar] = await Promise.all([
    source("../../frontend/src/pages/Cases.jsx"),
    source("../../frontend/src/components/cases/CasesCommandBar.jsx"),
  ]);

  assert.match(commandBar, /\[item\.assignedUser, item\.caseWorker\]\.filter\(Boolean\)/);
  assert.match(commandBar, /staffById\.set\(staff\.id, staff\)/);
  assert.match(commandBar, /<option key=\{staff\.id\} value=\{staff\.id\}>/);
  assert.match(casesPage, /caseItem\.assignedUser\?\.id === filters\.staff/);
  assert.match(casesPage, /caseItem\.caseWorker\?\.id === filters\.staff/);
});
