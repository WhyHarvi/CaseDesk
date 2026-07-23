import assert from "node:assert/strict";
import test from "node:test";
import { buildCaseInformationSummary } from "../src/modules/case-information/caseInformationWorkspace.js";

// Phase 6: manual section assignment. isVisible is the UI's "show this tab
// at all" signal — distinct from requirementLevel (the case type's static
// classification) and status (completion). A section is visible when it's
// required (case type structurally needs it), explicitly enabled, or
// already has real data (existing data never disappears from view).

test("with no enabledSectionKeys and no data: required sections are visible, optional ones are not", () => {
  // caseType "" resolves every section to the "optional" fallback level
  // (see caseRequirementResolver.js), so this exercises the all-optional,
  // all-empty case: nothing should be visible without explicit enabling.
  const result = buildCaseInformationSummary({ caseType: "", formData: {} });
  assert.ok(result.sections.every((section) => section.requirementLevel === "optional"));
  assert.ok(result.sections.every((section) => section.isVisible === false));
  assert.ok(result.sections.every((section) => section.enabled === false));
});

test("a required section is always visible even with no data and nothing enabled", () => {
  const result = buildCaseInformationSummary({ caseType: "Express Entry", formData: {} });
  const requiredSections = result.sections.filter((section) => section.requirementLevel === "required");
  assert.ok(requiredSections.length > 0);
  assert.ok(requiredSections.every((section) => section.isVisible === true));
});

test("enabledSectionKeys makes an otherwise-empty optional section visible", () => {
  const result = buildCaseInformationSummary({ caseType: "", formData: {}, enabledSectionKeys: new Set(["spouseDetails"]) });
  const spouse = result.sections.find((section) => section.sectionKey === "spouseDetails");
  assert.equal(spouse.enabled, true);
  assert.equal(spouse.isVisible, true);
  // Sections not in the set stay hidden — enabling one doesn't leak to others.
  const children = result.sections.find((section) => section.sectionKey === "children");
  assert.equal(children.enabled, false);
  assert.equal(children.isVisible, false);
});

test("a section with real data is visible even when not enabled and not required", () => {
  const result = buildCaseInformationSummary({ caseType: "", formData: { spouse: { firstName: "Jane" } } });
  const spouse = result.sections.find((section) => section.sectionKey === "spouseDetails");
  assert.equal(spouse.requirementLevel, "optional");
  assert.equal(spouse.enabled, false);
  assert.notEqual(spouse.status, "not_started");
  assert.equal(spouse.isVisible, true);
});

test("enabledSectionKeys is optional — omitting it entirely does not throw and behaves like an empty set", () => {
  const result = buildCaseInformationSummary({ caseType: "", formData: {} });
  assert.equal(result.sections.length, 16);
  assert.ok(result.sections.every((section) => section.isVisible === false));
});

test("a collection section marked complete=Yes with zero entries is still visible (real 'nothing to report' data, not emptiness)", () => {
  const result = buildCaseInformationSummary({ caseType: "", formData: { travelHistory: { entries: [], complete: "Yes", hasTravelled: "No" } } });
  const travelHistory = result.sections.find((section) => section.sectionKey === "travelHistory");
  assert.equal(travelHistory.status, "complete");
  assert.equal(travelHistory.filledCount, 0);
  assert.equal(travelHistory.isVisible, true);
});

test("a not_applicable-classified section with zero data stays hidden, not confused with 'has content'", () => {
  const result = buildCaseInformationSummary({ caseType: "Study Permit", formData: {} });
  const refugeeProtection = result.sections.find((section) => section.sectionKey === "refugeeProtection");
  assert.equal(refugeeProtection.status, "not_applicable");
  assert.equal(refugeeProtection.isVisible, false);
});
