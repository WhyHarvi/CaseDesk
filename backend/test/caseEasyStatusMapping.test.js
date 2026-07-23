import assert from "node:assert/strict";
import test from "node:test";
import { mapCaseEasyStatus } from "../src/services/caseEasyStatusMapping.js";

test("direct stage matches map correctly", () => {
  assert.deepEqual(mapCaseEasyStatus("Submitted"), { stage: "Submitted", status: "Active", archived: false, recognized: true });
  assert.deepEqual(mapCaseEasyStatus("Prospect"), { stage: "Lead", status: "Open", archived: false, recognized: true });
  assert.deepEqual(mapCaseEasyStatus("Closed"), { stage: "Closed", status: "Closed", archived: false, recognized: true });
});

test("Approved and Denied both land on Decision Received stage but different statuses", () => {
  assert.deepEqual(mapCaseEasyStatus("Approved"), { stage: "Decision Received", status: "Completed", archived: false, recognized: true });
  assert.deepEqual(mapCaseEasyStatus("Denied"), { stage: "Decision Received", status: "Closed", archived: false, recognized: true });
});

test("Archived sets the archived flag distinctly from status", () => {
  const result = mapCaseEasyStatus("Archived");
  assert.equal(result.status, "Closed");
  assert.equal(result.archived, true);
});

test("statuses with no clear pipeline signal default stage to Lead but stay recognized", () => {
  for (const status of ["Active", "Follow Up", "In Progress", "ITA Received", "Cancelled"]) {
    const result = mapCaseEasyStatus(status);
    assert.equal(result.stage, "Lead");
    assert.equal(result.recognized, true);
  }
});

test("is case-insensitive and trims whitespace", () => {
  assert.equal(mapCaseEasyStatus("  submitted  ").stage, "Submitted");
  assert.equal(mapCaseEasyStatus("SUBMITTED").stage, "Submitted");
});

test("an unrecognized status falls back to a safe default and is flagged unrecognized", () => {
  const result = mapCaseEasyStatus("Some New Status Case Easy Added Later");
  assert.equal(result.recognized, false);
  assert.equal(result.stage, "Lead");
  assert.equal(result.status, "Open");
});

test("blank/null status is treated as unrecognized, not a crash", () => {
  assert.equal(mapCaseEasyStatus(null).recognized, false);
  assert.equal(mapCaseEasyStatus("").recognized, false);
  assert.equal(mapCaseEasyStatus(undefined).recognized, false);
});
