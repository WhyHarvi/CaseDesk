import assert from "node:assert/strict";
import test from "node:test";
import { listAgencyCaseTypeOptions } from "../src/services/caseTypeOptionsService.js";

test("lead immigration interests include defaults and agency-specific case types without duplicates", async () => {
  const db = {
    case: {
      findMany: async () => [
        { caseType: "study permit" },
        { caseType: "Judicial Review" },
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
  assert.equal(
    options.filter((value) => value.toLowerCase() === "study permit").length,
    1,
  );
  assert.deepEqual(options, [...options].sort((left, right) => left.localeCompare(right)));
});
