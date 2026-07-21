import assert from "node:assert/strict";
import test from "node:test";
import { adaptLegacyFormData } from "../src/modules/case-information/legacyFormDataAdapter.js";

test("adapts every canonical section even when formData is empty", () => {
  const adapted = adaptLegacyFormData({});
  assert.equal(Object.keys(adapted).length, 16);
  assert.equal(adapted.applicantDetails.kind, "flat");
  assert.deepEqual(adapted.applicantDetails.raw, {});
  assert.equal(adapted.addressHistory.entryCount, 0);
});

test("handles a null/undefined formData without throwing", () => {
  assert.doesNotThrow(() => adaptLegacyFormData(null));
  assert.doesNotThrow(() => adaptLegacyFormData(undefined));
  assert.equal(Object.keys(adaptLegacyFormData(null)).length, 16);
});

test("merges applicantDetails from multiple legacy top-level keys plus the nested questionnaire path", () => {
  const formData = {
    profile: { firstName: "Amara" },
    language: { firstLanguage: "English" },
    profileQuestionnaires: { applicantIdentity: { familyName: "Okafor", gender: "Female" } },
  };
  const adapted = adaptLegacyFormData(formData);
  assert.deepEqual(adapted.applicantDetails.raw, { firstName: "Amara", firstLanguage: "English", familyName: "Okafor", gender: "Female" });
});

test("collection sections respect an explicit complete flag even with zero entries", () => {
  // Confirmed in real data: addressHistory can be { entries: [], complete: "Yes" } —
  // an explicit "confirmed nothing to report", not "not started".
  const formData = { addressHistory: { entries: [], complete: "Yes" } };
  const adapted = adaptLegacyFormData(formData);
  assert.equal(adapted.addressHistory.entryCount, 0);
  assert.equal(adapted.addressHistory.complete, "Yes");
});

test("collection sections carry their gate flag when the catalog defines one", () => {
  const formData = { travelHistory: { entries: [], hasTravelled: "No" } };
  const adapted = adaptLegacyFormData(formData);
  assert.equal(adapted.travelHistory.gate, "No");
  assert.equal(adapted.canadianStatus.gate, undefined); // flat sections never have a gate
});

test("pairedEntities section splits parents into father/mother sub-records", () => {
  const formData = { parents: { father: { familyName: "Okafor" }, mother: { familyName: "Smith" }, complete: "Yes" } };
  const adapted = adaptLegacyFormData(formData);
  assert.equal(adapted.parentDetails.pairs.father.familyName, "Okafor");
  assert.equal(adapted.parentDetails.pairs.mother.familyName, "Smith");
  assert.equal(adapted.parentDetails.complete, "Yes");
});

test("collection entries default to an empty array when the plural key holds something unexpected", () => {
  const adapted = adaptLegacyFormData({ siblings: { siblings: "not-an-array" } });
  assert.deepEqual(adapted.siblingDetails.entries, []);
});
