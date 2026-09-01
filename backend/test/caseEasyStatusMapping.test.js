import assert from "node:assert/strict";
import test from "node:test";
import { mapCaseEasyStatus } from "../src/services/caseEasyStatusMapping.js";

test("every recognized status lands Closed and archived — imported cases never enter the active pipeline", () => {
  assert.deepEqual(mapCaseEasyStatus("Submitted"), { stage: "Submitted", status: "Closed", archived: true, recognized: true });
  assert.deepEqual(mapCaseEasyStatus("Prospect"), { stage: "Lead", status: "Closed", archived: true, recognized: true });
  assert.deepEqual(mapCaseEasyStatus("Closed"), { stage: "Closed", status: "Closed", archived: true, recognized: true });
  // Not Decision Received: that stage requires a real case_decisions
  // record (outcome, permit expiry/refusal resolution) enforced by a DB
  // trigger, which Case Easy's export never captured — only a bare date.
  assert.deepEqual(mapCaseEasyStatus("Approved"), { stage: "Closed", status: "Closed", archived: true, recognized: true });
  assert.deepEqual(mapCaseEasyStatus("Denied"), { stage: "Closed", status: "Closed", archived: true, recognized: true });
  assert.deepEqual(mapCaseEasyStatus("Archived"), { stage: "Closed", status: "Closed", archived: true, recognized: true });
});

test("statuses with no clear pipeline signal default stage to Lead but stay recognized", () => {
  for (const status of ["Active", "Follow Up", "In Progress", "ITA Received", "Cancelled"]) {
    const result = mapCaseEasyStatus(status);
    assert.equal(result.stage, "Lead");
    assert.equal(result.status, "Closed");
    assert.equal(result.archived, true);
    assert.equal(result.recognized, true);
  }
});

test("is case-insensitive and trims whitespace", () => {
  assert.equal(mapCaseEasyStatus("  submitted  ").stage, "Submitted");
  assert.equal(mapCaseEasyStatus("SUBMITTED").stage, "Submitted");
});

test("an unrecognized status still lands Closed/archived and is flagged unrecognized", () => {
  const result = mapCaseEasyStatus("Some New Status Case Easy Added Later");
  assert.equal(result.recognized, false);
  assert.equal(result.stage, "Lead");
  assert.equal(result.status, "Closed");
  assert.equal(result.archived, true);
});

test("blank/null status is treated as unrecognized, not a crash, and still lands Closed/archived", () => {
  for (const value of [null, "", undefined]) {
    const result = mapCaseEasyStatus(value);
    assert.equal(result.recognized, false);
    assert.equal(result.status, "Closed");
    assert.equal(result.archived, true);
  }
});
