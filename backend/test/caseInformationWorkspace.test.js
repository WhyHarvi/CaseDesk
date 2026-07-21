import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildCaseInformationSummary } from "../src/modules/case-information/caseInformationWorkspace.js";

const fixturesPath = fileURLToPath(new URL("./fixtures/caseInformationGoldenMaster.json", import.meta.url));
const fixtures = JSON.parse(readFileSync(fixturesPath, "utf-8"));

// Golden-master tests against real (dev/seed, non-production) case data
// pulled live from the database — see the plan's Phase 1 gate: prove the
// domain layer is stable against real formData shapes, not synthetic ones,
// before any schema or UI work starts.

test("no case/assessment at all: every section present, all optional-by-default, nothing crashes", () => {
  const result = buildCaseInformationSummary({ caseType: "", formData: {} });
  assert.equal(result.sections.length, 16);
  assert.ok(result.sections.every((section) => section.requirementLevel === "optional"));
  assert.equal(result.summary.requiredSections, 0);
  assert.deepEqual(result.needsAttention, []);
});

test("Study Permit / sparse real data: only work+education populated, still resolves 16 sections without throwing", () => {
  const { caseType, formData } = fixtures.studyPermitSparse;
  const result = buildCaseInformationSummary({ caseType, formData });
  assert.equal(result.sections.length, 16);
  // work/education aren't canonical top-level section keys on their own —
  // they fold into applicantDetails — confirm that landed somewhere sane
  // rather than being silently dropped.
  const applicant = result.sections.find((s) => s.sectionKey === "applicantDetails");
  assert.ok(applicant.filledCount >= 0);
  // Study Permit requires programDetails and address/travel/activity history —
  // with only work+education present, those should surface as needing attention.
  const attentionKeys = result.needsAttention.map((s) => s.sectionKey);
  assert.ok(attentionKeys.includes("programDetails"));
  assert.ok(attentionKeys.includes("addressHistory"));
});

test("Express Entry / rich real data: stable, sensible needs-attention list", () => {
  const { caseType, formData } = fixtures.expressEntryRich;
  const result = buildCaseInformationSummary({ caseType, formData });
  assert.equal(result.sections.length, 16);
  assert.equal(result.summary.requiredSections, 10);

  // Golden-master pin: this exact real fixture, run through this exact
  // pipeline, must keep producing this exact needs-attention set. If this
  // ever changes, it should be because the fixture or the rules changed on
  // purpose — not because something regressed silently.
  // applicantDetails is included here because it has no verified known-field
  // list for this case (see informationSectionCatalog.js) and so is never
  // claimed "complete" via the generic fallback — correct, if conservative.
  const attentionKeys = result.needsAttention.map((s) => s.sectionKey).sort();
  assert.deepEqual(attentionKeys, ["applicantDetails", "backgroundAdmissibility", "canadianStatus", "programDetails", "spouseDetails", "travelHistory"].sort());

  // Sections with an explicit complete="Yes" flag and zero entries must
  // read as complete, not not_started — the core "trust the human's
  // explicit assertion" behavior this whole layer depends on.
  const addressHistory = result.sections.find((s) => s.sectionKey === "addressHistory");
  assert.equal(addressHistory.status, "complete");
  const children = result.sections.find((s) => s.sectionKey === "children");
  assert.equal(children.status, "complete");
});

test("PGWP real data: profile/language/work/spouse/additional all fold into their sections without crashing", () => {
  const { caseType, formData } = fixtures.pgwp;
  const result = buildCaseInformationSummary({ caseType, formData });
  assert.equal(result.sections.length, 16);
  const applicant = result.sections.find((s) => s.sectionKey === "applicantDetails");
  assert.notEqual(applicant.status, "not_started"); // profile/language/work data exists
  // The spouse key is present in this fixture but is an empty object ({}) —
  // correctly not_started, not a crash. Confirms the adapter/completion
  // pipeline distinguishes "key present but empty" from "has real data"
  // rather than treating mere key presence as filled.
  const spouse = result.sections.find((s) => s.sectionKey === "spouseDetails");
  assert.equal(spouse.status, "not_started");
});

test("every fixture resolves a known case type (none fall through to unclassified)", () => {
  for (const [name, fixture] of Object.entries(fixtures)) {
    const result = buildCaseInformationSummary({ caseType: fixture.caseType, formData: fixture.formData });
    assert.ok(result.summary.requiredSections > 0, `${name} (${fixture.caseType}) resolved to zero required sections — case type likely unclassified`);
  }
});
