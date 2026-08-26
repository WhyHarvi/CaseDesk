import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { clientPayload } from "../src/controllers/clientController.js";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("manual client intake creates an Active client and cannot recreate the retired Client/Lead hybrid", () => {
  assert.equal(clientPayload({ givenNames: "New", familyName: "Client" }).status, "Active");
  assert.equal(clientPayload({}, { fullName: "Existing", status: "Inactive" }).status, "Inactive");
  assert.throws(
    () => clientPayload({ givenNames: "Hybrid", status: "Lead" }),
    /Client status is invalid/,
  );
});

test("every client-creation UI and backend path observes the client/lead boundary", async () => {
  const [clientsPage, drawer, clientController, bookingController, retainerService, leadService, caseEasyController] = await Promise.all([
    source("../../frontend/src/pages/Clients.jsx"),
    source("../../frontend/src/components/clients/ClientEditDrawer.jsx"),
    source("../src/controllers/clientController.js"),
    source("../src/controllers/bookingController.js"),
    source("../src/modules/leads/lead.retainer.service.js"),
    source("../src/modules/leads/lead.service.js"),
    source("../src/controllers/caseEasyImportController.js"),
  ]);

  assert.match(clientsPage, /defaultClientFormState[\s\S]*?status: "Active"/);
  assert.doesNotMatch(clientsPage, /\["Lead", "Active", "Inactive", "Closed"\]/);
  assert.match(drawer, /status: "Active"/);
  assert.doesNotMatch(drawer, /\["Lead", "Active", "Inactive", "Closed"\]/);
  assert.match(clientController, /CLIENT_STATUSES = \["Active", "Inactive", "Closed"\]/);
  assert.match(bookingController, /status: "Active"/);
  assert.match(retainerService, /earlyClientId:[\s\S]*?status: "Active"/);
  assert.match(leadService, /client = await tx\.client\.create\([\s\S]*?status: "Active"/);
  assert.match(caseEasyController, /client = await tx\.client\.create\([\s\S]*?status: "Active"/);
});

test("the repair migration activates stranded clients and blocks recurrence below the API layer", async () => {
  const migration = await source("../prisma/migrations/20260826224500_remove_legacy_client_lead_state/migration.sql");
  assert.match(migration, /UPDATE "clients"[\s\S]*SET "status" = 'Active'/);
  assert.match(migration, /WHERE "status" = 'Lead'/);
  assert.match(migration, /ADD CONSTRAINT "clients_status_must_not_be_lead"/);
  assert.match(migration, /CHECK \("status" <> 'Lead'/);
});
