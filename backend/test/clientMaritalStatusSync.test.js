import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  formDataWithMaritalStatus,
  MARITAL_STATUS_VALUES,
  normalizeMaritalStatus,
} from "../src/services/clientProfileSyncService.js";

const source = (relativePath) =>
  readFile(new URL(relativePath, import.meta.url), "utf8");

test("marital status aliases normalize to the shared profile values", () => {
  assert.equal(normalizeMaritalStatus("single"), "Never Married / Single");
  assert.equal(normalizeMaritalStatus(" Common Law "), "Common-Law");
  assert.equal(normalizeMaritalStatus("Married"), "Married");
  assert.equal(normalizeMaritalStatus(""), null);
  assert.equal(normalizeMaritalStatus("unknown"), undefined);
  assert.ok(MARITAL_STATUS_VALUES.includes("Legally Separated"));
});

test("canonical marital status merges without discarding other case profile data", () => {
  const original = {
    profile: { age: "34", countryOfCitizenship: "Canada" },
    work: { years: "5" },
  };
  const result = formDataWithMaritalStatus(original, "Married");

  assert.deepEqual(result, {
    profile: {
      age: "34",
      countryOfCitizenship: "Canada",
      maritalStatus: "Married",
    },
    work: { years: "5" },
  });
  assert.equal(original.profile.maritalStatus, undefined);
});

test("client editing and case assessments share the canonical marital status", async () => {
  const [drawer, clientController, assessmentController] = await Promise.all([
    source("../../frontend/src/components/clients/ClientEditDrawer.jsx"),
    source("../src/controllers/clientController.js"),
    source("../src/controllers/caseAssessmentController.js"),
  ]);

  assert.match(drawer, /name="maritalStatus"/);
  assert.match(drawer, /maritalStatusOptions\.map/);
  assert.match(clientController, /syncClientMaritalStatus/);
  assert.match(assessmentController, /syncClientMaritalStatus/);
  assert.match(assessmentController, /formDataWithMaritalStatus/);
});
