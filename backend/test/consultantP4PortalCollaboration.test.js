import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { documentStoragePath } from "../src/services/documentStorage.js";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("portal document operations require linked ownership and client visibility", async () => {
  const [controller, routes] = await Promise.all([
    source("../src/controllers/portalController.js"),
    source("../src/routes/portalRoutes.js"),
  ]);
  assert.match(controller, /clientId: link\.clientId, visibility: "Client"/);
  assert.match(controller, /updatedAt: existing\.updatedAt, status: \{ notIn: \["Approved", "Finalized", "NotRequired"\] \}/);
  assert.match(controller, /hasFile: Boolean\(storageKey\)/);
  assert.match(controller, /data\.map\(\(\{ storageKey, \.\.\.item \}\) => \(\{ \.\.\.item, hasFile:/);
  assert.match(routes, /documents\/:id\/upload/);
  assert.match(routes, /documents\/:id\/file/);
  assert.match(routes, /rateLimit\(\{ windowMs: 60_000, max: 10 \}\)/);
});

test("document storage rejects paths outside the private storage root", () => {
  assert.throws(() => documentStoragePath("../../outside.pdf"), /Invalid document storage path/);
  assert.match(documentStoragePath("agency/case/file.pdf"), /storage\/documents\/agency\/case\/file\.pdf$/);
});

test("client instructions are separate from internal document notes", async () => {
  const [schema, migration, controller, page] = await Promise.all([
    source("../prisma/schema.prisma"),
    source("../prisma/migrations/20260715210000_add_client_document_instructions/migration.sql"),
    source("../src/controllers/portalController.js"),
    source("../../frontend/src/pages/Documents.jsx"),
  ]);
  assert.match(schema, /clientInstructions\s+String\?\s+@map\("client_instructions"\)/);
  assert.match(migration, /ADD COLUMN "client_instructions" TEXT/);
  assert.match(controller, /clientInstructions: true/);
  assert.doesNotMatch(controller.slice(controller.indexOf("export async function portalDocuments"), controller.indexOf("export async function uploadPortalDocument")), /notes: true/);
  assert.match(page, /This is visible to the client/);
  assert.match(page, />Internal notes</);
});

test("portal messages expose chat only and never internal communication", async () => {
  const [controller, routes] = await Promise.all([
    source("../src/controllers/portalController.js"),
    source("../src/routes/portalRoutes.js"),
  ]);
  const listSection = controller.slice(controller.indexOf("export async function portalMessages"), controller.indexOf("export async function createPortalMessage"));
  assert.match(listSection, /clientId: link\.clientId, caseId, channel: "Chat"/);
  assert.match(listSection, /direction: \{ in: \["Inbound", "Outbound"\] \}/);
  assert.match(listSection, /deletedAt: null/);
  assert.doesNotMatch(listSection, /bodyHtml|attachments|metadata/);
  assert.match(controller, /provider: "AuthenticatedPortal"/);
  assert.match(controller, /state: "WaitingOnAgency"/);
  assert.match(routes, /router\.post\("\/messages", rateLimit/);
});

test("portal UI provides actions, appointments, file exchange, and messaging", async () => {
  const page = await source("../../frontend/src/pages/Portal.jsx");
  assert.match(page, /Requested actions/);
  assert.match(page, /Upcoming appointments/);
  assert.match(page, /portal\/documents\/\$\{documentItem\.id\}\/upload/);
  assert.match(page, /portal\/documents\/\$\{documentItem\.id\}\/file/);
  assert.match(page, /api\.post\("\/portal\/messages"/);
  assert.match(page, /Instructions from your case team/);
  assert.match(page, /Contact your case team if this information needs to change/);
});
