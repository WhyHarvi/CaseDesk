import assert from "node:assert/strict";
import test from "node:test";
import { resolveSectionRequirement, resolveSectionRequirements } from "../src/modules/case-information/caseRequirementResolver.js";

test("returns exactly the 16 canonical sections for a recognized case type", () => {
  const requirements = resolveSectionRequirements("Express Entry");
  assert.equal(requirements.length, 16);
});

test("Spousal and Family Sponsorship requires spouse, children, and sponsorship sections", () => {
  const requirements = resolveSectionRequirements("Spousal Sponsorship");
  const byKey = Object.fromEntries(requirements.map((r) => [r.sectionKey, r.level]));
  assert.equal(byKey.spouseDetails, "required");
  assert.equal(byKey.children, "required");
  assert.equal(byKey.relationshipSponsorship, "required");
  assert.equal(byKey.refugeeProtection, "not_applicable");
});

test("LMIA employer service leaves personal-history sections not applicable", () => {
  const requirements = resolveSectionRequirements("LMIA");
  const byKey = Object.fromEntries(requirements.map((r) => [r.sectionKey, r.level]));
  assert.equal(byKey.addressHistory, "not_applicable");
  assert.equal(byKey.programDetails, "required");
});

test("an unrecognized free-text case type falls back to optional for every section, never not_applicable", () => {
  const requirements = resolveSectionRequirements("Totally Made Up Type");
  assert.ok(requirements.every((r) => r.level === "optional"));
});

test("a real-world alias not in the exact list (Study Permit Extension) still resolves sensibly", () => {
  const requirements = resolveSectionRequirements("Study Permit Extension");
  const byKey = Object.fromEntries(requirements.map((r) => [r.sectionKey, r.level]));
  assert.equal(byKey.programDetails, "required");
});

test("resolveSectionRequirement looks up a single section", () => {
  const entry = resolveSectionRequirement("Express Entry", "spouseDetails");
  assert.equal(entry.sectionKey, "spouseDetails");
  assert.equal(entry.level, "required");
  assert.equal(resolveSectionRequirement("Express Entry", "not-a-real-section"), null);
});
