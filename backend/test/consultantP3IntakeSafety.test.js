import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertNoContactDuplicate, normalizeContact } from "../src/services/contactDuplicateService.js";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("client contact normalization detects equivalent phone and email formats", () => {
  const first = normalizeContact({ phone: "(416) 555-0100", email: " Client@Example.CA " });
  const second = normalizeContact({ phone: "+1 416 555 0100", email: "client@example.ca" });
  assert.equal(first.phoneNormalized, "+14165550100");
  assert.equal(first.phoneNormalized, second.phoneNormalized);
  assert.equal(first.emailNormalized, second.emailNormalized);
});

test("duplicate checks cover both existing clients and active leads", async () => {
  const clientDb = {
    client: { findFirst: async () => ({ id: "client-1", fullName: "Existing Client", phoneNormalized: "+14165550100" }) },
    lead: { findFirst: async () => null },
  };
  await assert.rejects(
    () => assertNoContactDuplicate(clientDb, { agencyId: "agency-1", phoneNormalized: "+14165550100" }),
    (error) => error.code === "DUPLICATE_CLIENT" && error.statusCode === 409,
  );

  const leadDb = {
    client: { findFirst: async () => null },
    lead: { findFirst: async () => ({ id: "lead-1", leadNumber: "LD-2026-000010", firstName: "Existing", lastName: "Lead", emailNormalized: "lead@example.ca" }) },
  };
  await assert.rejects(
    () => assertNoContactDuplicate(leadDb, { agencyId: "agency-1", emailNormalized: "lead@example.ca" }),
    (error) => error.code === "DUPLICATE_LEAD" && error.statusCode === 409,
  );
});

test("database constraints and transactions protect client intake from races", async () => {
  const [schema, migration, clientController, leadService] = await Promise.all([
    source("../prisma/schema.prisma"),
    source("../prisma/migrations/20260715190000_harden_client_case_intake/migration.sql"),
    source("../src/controllers/clientController.js"),
    source("../src/modules/leads/lead.service.js"),
  ]);
  assert.match(schema, /@@unique\(\[agencyId, phoneNormalized\]\)/);
  assert.match(schema, /@@unique\(\[agencyId, emailNormalized\]\)/);
  assert.match(migration, /CREATE UNIQUE INDEX "clients_agency_id_phone_normalized_key"/);
  assert.match(clientController, /lockAgencyContactIntake/);
  assert.match(clientController, /assertNoContactDuplicate/);
  assert.match(leadService, /excludeLeadId: lead\.id/);
  assert.match(leadService, /phoneNormalized: lead\.phoneNormalized/);
});

test("cases use controlled lifecycle values and persistent priority", async () => {
  const [schema, controller, page] = await Promise.all([
    source("../prisma/schema.prisma"),
    source("../src/controllers/caseController.js"),
    source("../../frontend/src/pages/Cases.jsx"),
  ]);
  assert.match(schema, /priority\s+String\s+@default\("Normal"\)/);
  assert.match(controller, /CASE_STATUSES = \["Open", "Active", "On Hold", "Completed", "Closed", "Cancelled", "Inactive"\]/);
  assert.match(controller, /CASE_PRIORITIES = \["Low", "Normal", "High", "Urgent"\]/);
  assert.match(controller, /An active case requires a clear next action/);
  assert.match(page, /name="priority"/);
  assert.match(page, /STATUS_OPTIONS\.map/);
  assert.doesNotMatch(page, /item\.priority \|\|\s*\(urgent/);
});

test("client case and follow-up removal paths preserve history", async () => {
  const [clientRoutes, caseRoutes, followUpRoutes, caseController, clientPage, casesPage, followUpsPage] = await Promise.all([
    source("../src/routes/clientRoutes.js"),
    source("../src/routes/caseRoutes.js"),
    source("../src/routes/followUpRoutes.js"),
    source("../src/controllers/caseController.js"),
    source("../../frontend/src/pages/Clients.jsx"),
    source("../../frontend/src/pages/Cases.jsx"),
    source("../../frontend/src/pages/FollowUps.jsx"),
  ]);
  assert.doesNotMatch(clientRoutes, /router\.delete/);
  assert.doesNotMatch(caseRoutes, /router\.delete\("\/:id"/);
  assert.doesNotMatch(followUpRoutes, /router\.delete/);
  assert.match(caseController, /status: "Cancelled", isActive: false/);
  assert.match(caseController, /followUp\.updateMany/);
  assert.match(clientPage, /clients\/\$\{client\.id\}\/archive-impact/);
  assert.match(clientPage, /clients\/\$\{client\.id\}\/archive/);
  assert.match(clientPage, /Nothing will be permanently deleted/);
  assert.match(casesPage, /cases\/\$\{item\.id\}\/close/);
  assert.match(followUpsPage, /follow-ups\/\$\{item\.id\}\/cancel/);
});

test("client payloads scope nested cases and never fabricate operational values", async () => {
  const [controller, page] = await Promise.all([
    source("../src/controllers/clientController.js"),
    source("../../frontend/src/pages/Clients.jsx"),
  ]);
  assert.match(controller, /cases: \{[\s\S]*where: caseAccessWhere\(req\)/);
  assert.match(controller, /caseId: \{ in: accessibleCaseIds \}/);
  assert.match(page, /currentCase\?\.clientDocuments/);
  assert.match(page, /currentCase\?\.payments/);
  assert.match(page, /currentCase\?\.followUps/);
  assert.doesNotMatch(page, /demoMissingDocs|demoPaymentStates|demoNextActions|demoStages/);
});
