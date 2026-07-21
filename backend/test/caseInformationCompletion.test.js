import assert from "node:assert/strict";
import test from "node:test";
import { calculateSectionStatus } from "../src/modules/case-information/sectionCompletionService.js";

test("flat section with a known field list: not_started when nothing is filled", () => {
  const result = calculateSectionStatus({
    sectionKey: "canadianStatus",
    adaptedSection: { kind: "flat", raw: {} },
    knownFields: ["currentlyInCanada", "currentStatus"],
    requirementLevel: "required",
  });
  assert.equal(result.status, "not_started");
  assert.equal(result.filledCount, 0);
});

test("flat section with a known field list: in_progress when partially filled", () => {
  const result = calculateSectionStatus({
    sectionKey: "canadianStatus",
    adaptedSection: { kind: "flat", raw: { currentlyInCanada: "Yes" } },
    knownFields: ["currentlyInCanada", "currentStatus"],
    requirementLevel: "required",
  });
  assert.equal(result.status, "in_progress");
  assert.equal(result.filledCount, 1);
  assert.equal(result.totalCount, 2);
});

test("flat section with a known field list: complete when every field is filled", () => {
  const result = calculateSectionStatus({
    sectionKey: "canadianStatus",
    adaptedSection: { kind: "flat", raw: { currentlyInCanada: "Yes", currentStatus: "Visitor" } },
    knownFields: ["currentlyInCanada", "currentStatus"],
    requirementLevel: "required",
  });
  assert.equal(result.status, "complete");
});

test("flat section with no known field list falls back to presence-of-any-key, never claims complete", () => {
  const empty = calculateSectionStatus({ sectionKey: "spouseDetails", adaptedSection: { kind: "flat", raw: {} }, knownFields: null, requirementLevel: "optional" });
  assert.equal(empty.status, "not_started");
  const partial = calculateSectionStatus({ sectionKey: "spouseDetails", adaptedSection: { kind: "flat", raw: { firstName: "Jane" } }, knownFields: null, requirementLevel: "optional" });
  assert.equal(partial.status, "in_progress");
});

test("collection section: explicit complete=Yes wins even with zero entries", () => {
  // Confirmed real-world pattern: addressHistory: { entries: [], complete: "Yes" }.
  const result = calculateSectionStatus({
    sectionKey: "addressHistory",
    adaptedSection: { kind: "collection", raw: {}, entries: [], entryCount: 0, complete: "Yes" },
    knownFields: null,
    requirementLevel: "required",
  });
  assert.equal(result.status, "complete");
});

test("collection section: no explicit complete flag infers from entry count", () => {
  const noEntries = calculateSectionStatus({ sectionKey: "travelHistory", adaptedSection: { kind: "collection", raw: {}, entries: [], entryCount: 0, complete: undefined }, knownFields: null, requirementLevel: "required" });
  assert.equal(noEntries.status, "not_started");
  const withEntries = calculateSectionStatus({ sectionKey: "travelHistory", adaptedSection: { kind: "collection", raw: {}, entries: [{}], entryCount: 1, complete: undefined }, knownFields: null, requirementLevel: "required" });
  assert.equal(withEntries.status, "in_progress");
});

test("collection section: explicit complete=No with entries present is in_progress, not complete", () => {
  const result = calculateSectionStatus({
    sectionKey: "siblingDetails",
    adaptedSection: { kind: "collection", raw: {}, entries: [{}], entryCount: 1, complete: "No" },
    knownFields: null,
    requirementLevel: "optional",
  });
  assert.equal(result.status, "in_progress");
});

test("pairedEntities section: explicit complete=Yes wins even when both parents are blank", () => {
  // Confirmed real-world pattern: a parent marked complete with every field an empty string.
  const result = calculateSectionStatus({
    sectionKey: "parentDetails",
    adaptedSection: { kind: "pairedEntities", raw: {}, pairs: { father: {}, mother: {} }, complete: "Yes" },
    knownFields: ["familyName", "givenNames"],
    requirementLevel: "optional",
  });
  assert.equal(result.status, "complete");
  assert.equal(result.filledCount, 0);
});

test("pairedEntities section: no explicit flag infers from combined field fill ratio across both parents", () => {
  const result = calculateSectionStatus({
    sectionKey: "parentDetails",
    adaptedSection: { kind: "pairedEntities", raw: {}, pairs: { father: { familyName: "Okafor" }, mother: {} }, complete: undefined },
    knownFields: ["familyName", "givenNames"],
    requirementLevel: "optional",
  });
  assert.equal(result.status, "in_progress");
  assert.equal(result.filledCount, 1);
  assert.equal(result.totalCount, 4);
});

test("not_applicable requirement short-circuits status when there is genuinely no data", () => {
  const result = calculateSectionStatus({
    sectionKey: "refugeeProtection",
    adaptedSection: { kind: "flat", raw: {} },
    knownFields: ["claimBasis"],
    requirementLevel: "not_applicable",
  });
  assert.equal(result.status, "not_applicable");
});

test("not_applicable requirement does NOT hide a section that already has real stored data", () => {
  // Key behavior from the parent plan: existing stored information stays
  // visible even if its requirement later disappears (e.g. case type changed).
  const result = calculateSectionStatus({
    sectionKey: "refugeeProtection",
    adaptedSection: { kind: "flat", raw: { claimBasis: "Persecution on political grounds" } },
    knownFields: ["claimBasis"],
    requirementLevel: "not_applicable",
  });
  assert.notEqual(result.status, "not_applicable");
  assert.equal(result.status, "complete");
});
