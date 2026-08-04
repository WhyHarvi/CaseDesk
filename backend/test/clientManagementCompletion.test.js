import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("client management stores searchable identity fields and archives without deletion", async () => {
  const [schema, migration, controller, routes, page, profile] = await Promise.all([
    source("../prisma/schema.prisma"),
    source("../prisma/migrations/20260716120000_complete_client_management/migration.sql"),
    source("../src/controllers/clientController.js"),
    source("../src/routes/clientRoutes.js"),
    source("../../frontend/src/pages/Clients.jsx"),
    source("../../frontend/src/pages/ClientProfile.jsx"),
  ]);

  assert.match(schema, /clientNumber\s+String\s+@map\("client_number"\)/);
  assert.match(schema, /preferredLanguage\s+String\?/);
  assert.match(schema, /identificationNumber\s+String\?/);
  assert.match(schema, /archivedAt\s+DateTime\?/);
  assert.match(migration, /CREATE UNIQUE INDEX "clients_agency_id_client_number_key"/);
  assert.match(controller, /assertNoContactDuplicate/);
  assert.match(controller, /archivedAt: new Date\(\), status: "Inactive"/);
  assert.doesNotMatch(routes, /router\.delete/);
  assert.match(page, /archive-impact/);
  assert.match(page, /client\.clientNumber/);
  assert.match(page, /directoryOrder === "recentlyAdded"/);
  assert.match(page, /new Date\(right\.createdAt \|\| 0\)/);
  assert.match(page, /Recently added/);
  assert.match(profile, /Preferred language/);
  assert.match(profile, /Identification/);
});
