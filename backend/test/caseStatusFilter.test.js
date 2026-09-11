import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildCaseStatusFilterOptions,
  CASE_STATUSES,
} from "../../frontend/src/utils/caseStatuses.js";

test("case status filters expose only real statuses in the current register", async () => {
  const commandBar = await readFile(
    new URL("../../frontend/src/components/cases/CasesCommandBar.jsx", import.meta.url),
    "utf8",
  );

  assert.deepEqual(CASE_STATUSES, [
    "Open",
    "Active",
    "On Hold",
    "Completed",
    "Closed",
    "Cancelled",
    "Inactive",
  ]);

  assert.deepEqual(
    buildCaseStatusFilterOptions([
      { status: "On Hold", stage: "Submitted" },
      { status: "Active", stage: "Ready" },
      { status: "Open", stage: "Lead" },
    ]),
    ["Open", "Active", "On Hold"],
  );

  assert.deepEqual(
    buildCaseStatusFilterOptions([
      { status: "Inactive" },
      { status: "Closed" },
      { status: "Cancelled" },
      { status: "Completed" },
    ]),
    ["Completed", "Closed", "Cancelled", "Inactive"],
  );
  assert.match(commandBar, /buildCaseStatusFilterOptions\(cases, filters\.status\)/);
  assert.match(commandBar, /visibleStatuses\.map\(\(status\)/);
  assert.doesNotMatch(commandBar, /const STATUSES = \["Active", "Ready", "Submitted"/);
});

test("a selected status stays visible while the register refreshes", () => {
  assert.deepEqual(buildCaseStatusFilterOptions([], "Closed"), ["Closed"]);
});
