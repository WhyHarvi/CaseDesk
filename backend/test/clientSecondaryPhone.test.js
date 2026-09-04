import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { clientPayload } from "../src/controllers/clientController.js";
import { resolveSourcePath } from "../src/services/formDataSourceRegistry.js";
import { guessFieldMapping } from "../src/services/formFieldLabelHeuristics.js";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("client payload normalizes and preserves distinct primary and secondary phones", () => {
  const payload = clientPayload({
    givenNames: "Aman",
    phone: "(416) 555-0100",
    secondaryPhone: "+1 647 555 0101",
  });
  assert.equal(payload.phone, "(416) 555-0100");
  assert.equal(payload.phoneNormalized, "+14165550100");
  assert.equal(payload.secondaryPhone, "+1 647 555 0101");
  assert.equal(payload.secondaryPhoneNormalized, "+16475550101");
});

test("client payload rejects the same number in both phone fields", () => {
  assert.throws(
    () => clientPayload({ givenNames: "Aman", phone: "416-555-0100", secondaryPhone: "+1 (416) 555-0100" }),
    /must be different/,
  );
});

test("secondary phone is available to mapped case forms", () => {
  assert.equal(resolveSourcePath("client.secondaryPhone", { client: { secondaryPhone: "+16475550101" } }), "+16475550101");
  assert.equal(guessFieldMapping("alternateTelephone").sourcePath, "client.secondaryPhone");
});

test("secondary phone is carried through client-facing and integration surfaces", async () => {
  const [migration, profile, portal, calls, quickBooks, caseEasy] = await Promise.all([
    source("../prisma/migrations/20260904120000_add_client_secondary_phone/migration.sql"),
    source("../../frontend/src/pages/ClientProfile.jsx"),
    source("../../frontend/src/pages/client-portal/ClientPortalProfile.jsx"),
    source("../src/services/twilioCallService.js"),
    source("../src/services/clientQuickBooksSyncService.js"),
    source("../src/services/caseEasyImportService.js"),
  ]);
  assert.match(migration, /secondary_phone_normalized/);
  assert.match(migration, /clients_distinct_phone_numbers_check/);
  assert.match(profile, /Secondary: \$\{client\.secondaryPhone\}/);
  assert.match(portal, /secondaryPhone/);
  assert.match(calls, /secondaryPhoneNormalized/);
  assert.match(quickBooks, /alternatePhone: client\.secondaryPhone/);
  assert.match(caseEasy, /client\.secondaryPhoneNormalized/);
});
