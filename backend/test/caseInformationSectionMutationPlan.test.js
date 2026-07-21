import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildSectionMutationPlan, UnknownSectionError, UnsupportedSectionMutationError } from "../src/modules/case-information/sectionMutationPlan.js";

const fixturesPath = fileURLToPath(new URL("./fixtures/caseInformationGoldenMaster.json", import.meta.url));
const fixtures = JSON.parse(readFileSync(fixturesPath, "utf-8"));

test("rejects an unknown section key", () => {
  assert.throws(() => buildSectionMutationPlan({ sectionKey: "notASection", formData: {}, rawValue: {} }), UnknownSectionError);
});

test("rejects applicantDetails: merges multiple legacy paths, no single write target", () => {
  assert.throws(() => buildSectionMutationPlan({ sectionKey: "applicantDetails", formData: {}, rawValue: {} }), UnsupportedSectionMutationError);
});

test("rejects a non-object rawValue", () => {
  assert.throws(() => buildSectionMutationPlan({ sectionKey: "spouseDetails", formData: {}, rawValue: "not an object" }), /plain object/);
  assert.throws(() => buildSectionMutationPlan({ sectionKey: "spouseDetails", formData: {}, rawValue: null }), /plain object/);
});

test("flat top-level section (spouseDetails): writes to formData.spouse and re-adapts", () => {
  const { formData } = fixtures.expressEntryRich;
  const plan = buildSectionMutationPlan({
    sectionKey: "spouseDetails",
    formData,
    rawValue: { firstName: "Jane", lastName: "Doe" },
  });
  assert.equal(plan.scope, "client");
  assert.equal(plan.legacyPath, "spouse");
  assert.deepEqual(plan.newFormData.spouse, { firstName: "Jane", lastName: "Doe" });
  assert.deepEqual(plan.canonicalData, { kind: "flat", raw: { firstName: "Jane", lastName: "Doe" } });
  // Original formData object must not be mutated in place.
  assert.notEqual(formData.spouse, plan.newFormData.spouse);
});

test("dotted-path section (canadianStatus): writes under profileQuestionnaires without disturbing sibling keys", () => {
  const { formData } = fixtures.expressEntryRich;
  const otherSibling = formData.profileQuestionnaires?.background;
  const plan = buildSectionMutationPlan({
    sectionKey: "canadianStatus",
    formData,
    rawValue: { currentlyInCanada: "Yes", currentStatus: "Visitor" },
  });
  assert.equal(plan.scope, "case");
  assert.equal(plan.legacyPath, "profileQuestionnaires.canadianStatus");
  assert.deepEqual(plan.newFormData.profileQuestionnaires.canadianStatus, { currentlyInCanada: "Yes", currentStatus: "Visitor" });
  // Sibling profileQuestionnaires keys must survive untouched.
  assert.deepEqual(plan.newFormData.profileQuestionnaires.background, otherSibling);
  assert.notEqual(formData.profileQuestionnaires, plan.newFormData.profileQuestionnaires);
});

test("collection section (travelHistory): raw value round-trips through the same adapter everyone else uses", () => {
  const { formData } = fixtures.expressEntryRich;
  const rawValue = { entries: [{ country: "Mexico", entryDate: "2024-01-01" }], complete: "Yes", hasTravelled: "Yes" };
  const plan = buildSectionMutationPlan({ sectionKey: "travelHistory", formData, rawValue });
  assert.equal(plan.canonicalData.kind, "collection");
  assert.equal(plan.canonicalData.entryCount, 1);
  assert.equal(plan.canonicalData.complete, "Yes");
  assert.equal(plan.canonicalData.gate, "Yes");
});

test("paired-entities section (parentDetails): raw value round-trips correctly", () => {
  const { formData } = fixtures.pgwp;
  const rawValue = { father: { familyName: "Okafor" }, mother: {}, complete: "No" };
  const plan = buildSectionMutationPlan({ sectionKey: "parentDetails", formData, rawValue });
  assert.equal(plan.canonicalData.kind, "pairedEntities");
  assert.deepEqual(plan.canonicalData.pairs.father, { familyName: "Okafor" });
  assert.equal(plan.canonicalData.complete, "No");
});

test("writing to a case with no prior formData at all still produces a valid plan", () => {
  const plan = buildSectionMutationPlan({ sectionKey: "addressHistory", formData: {}, rawValue: { entries: [], complete: "No" } });
  assert.equal(plan.canonicalData.entryCount, 0);
  assert.equal(plan.canonicalData.complete, "No");
});
