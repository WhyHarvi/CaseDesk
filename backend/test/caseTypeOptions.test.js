import assert from "node:assert/strict";
import test from "node:test";
import { isCaseTypeOption, listAgencyCaseTypeOptions } from "../src/services/caseTypeOptionsService.js";
import { canonicalCaseType } from "../src/services/workflowService.js";

test("case type options reject intake answers while retaining custom legal categories", () => {
  assert.equal(isCaseTypeOption("I want to discuss my spousal pr application process"), false);
  assert.equal(isCaseTypeOption("We need help with a refused application"), false);
  assert.equal(isCaseTypeOption("Judicial Review"), true);
  assert.equal(isCaseTypeOption("Humanitarian and Compassionate Application"), true);
});

test("SOWP aliases resolve to one case type without collapsing distinct SOWP services", () => {
  assert.equal(canonicalCaseType("SOWP"), "Spousal Open Work Permit");
  assert.equal(canonicalCaseType("spousal open wok permit"), "Spousal Open Work Permit");
  assert.equal(canonicalCaseType("Spousal OWP"), "Spousal Open Work Permit");
  assert.equal(canonicalCaseType("SOWP Extension"), "SOWP Extension");
  assert.equal(canonicalCaseType("SOWP (Outside Canada)"), "SOWP (Outside Canada)");
});

test("custom case types always start with a capital letter", () => {
  assert.equal(canonicalCaseType("study permit with spouse"), "Study permit with spouse");
  assert.equal(canonicalCaseType("  judicial   review  "), "Judicial review");
  assert.equal(canonicalCaseType("Study Permit"), "Study Permit");
});

test("lead immigration interests include defaults and agency-specific case types without duplicates", async () => {
  const db = {
    case: {
      findMany: async () => [
        { caseType: "study permit" },
        { caseType: "Judicial Review" },
        { caseType: "I want to discuss my spousal pr application process" },
        { caseType: "SOWP" },
        { caseType: "spousal open work permit" },
      ],
    },
    documentTemplate: {
      findMany: async () => [
        { caseType: "Study Permit" },
        { caseType: "Mandamus Application" },
      ],
    },
    workflowTemplate: {
      findMany: async () => [{ caseType: "Visitor Visa - TRV" }],
    },
  };

  const options = await listAgencyCaseTypeOptions("agency-1", db);

  assert.ok(options.includes("Study Permit"));
  assert.ok(options.includes("Canadian Citizenship"));
  assert.ok(options.includes("Judicial Review"));
  assert.ok(options.includes("Mandamus Application"));
  assert.ok(options.includes("Canadian Experience Class"));
  assert.ok(options.includes("Humanitarian and Compassionate Considerations"));
  assert.ok(options.includes("Criminal Rehabilitation"));
  assert.equal(options.filter((value) => value === "Spousal Open Work Permit").length, 1);
  assert.ok(!options.includes("SOWP"));
  assert.ok(!options.includes("I want to discuss my spousal pr application process"));
  assert.equal(
    options.filter((value) => value.toLowerCase() === "study permit").length,
    1,
  );
  assert.deepEqual(options, [...options].sort((left, right) => left.localeCompare(right)));
});
