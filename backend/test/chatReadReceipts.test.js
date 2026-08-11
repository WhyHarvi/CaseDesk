import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("clientLastReadAt is an additive, nullable column that doesn't touch isRead/unreadCount/SLA machinery", async () => {
  const [schema, migration] = await Promise.all([
    source("../prisma/schema.prisma"),
    source("../prisma/migrations/20260811230000_communication_chat_read_receipts/migration.sql"),
  ]);
  assert.match(schema, /clientLastReadAt DateTime\?\s+@map\("client_last_read_at"\)/);
  assert.match(migration, /ALTER TABLE "communication_conversations"\s*\n\s*ADD COLUMN "client_last_read_at" TIMESTAMP\(3\);/);
  // No backfill statement, no NOT NULL, no default — existing rows just
  // start with an unknown read state.
  assert.doesNotMatch(migration, /UPDATE "communication_conversations"/);
  assert.doesNotMatch(migration, /NOT NULL/);
});

test("marking a chat thread read is scoped to the requesting client's own conversation on both the authenticated portal and token-link surfaces", async () => {
  const [portalController, portalRoutes, clientCommunicationController, clientCommunicationRoutes] = await Promise.all([
    source("../src/controllers/portalController.js"),
    source("../src/routes/portalRoutes.js"),
    source("../src/controllers/clientCommunicationController.js"),
    source("../src/routes/clientCommunicationRoutes.js"),
  ]);

  const portalMarkRead = portalController.slice(
    portalController.indexOf("export async function markPortalChatRead"),
    portalController.indexOf("// General (pre-case) chat"),
  );
  assert.match(portalMarkRead, /const link = await linkedClient\(req\);/);
  assert.match(portalMarkRead, /clientId: link\.clientId,/);
  assert.match(portalMarkRead, /channel: "Chat",/);
  assert.match(portalMarkRead, /data: \{ clientLastReadAt: new Date\(\) \},/);
  assert.match(portalRoutes, /router\.post\("\/messages\/read", asyncHandler\(markPortalChatRead\)\);/);

  const tokenMarkRead = clientCommunicationController.slice(
    clientCommunicationController.indexOf("export async function markClientChatRead"),
    clientCommunicationController.indexOf("export async function createClientChatMessage"),
  );
  assert.match(tokenMarkRead, /const access = await validAccess\(req\.params\.token\);/);
  assert.match(tokenMarkRead, /caseId: access\.caseId, channel: "Chat"/);
  assert.match(tokenMarkRead, /data: \{ clientLastReadAt: new Date\(\) \},/);
  assert.match(clientCommunicationRoutes, /router\.post\("\/:token\/messages\/read", asyncHandler\(markClientChatRead\)\);/);
});

test("the staff-side conversation query already returns every scalar field via include (not a restrictive select), so clientLastReadAt reaches the UI with no extra query change", async () => {
  const controller = await source("../src/controllers/communicationController.js");
  const conversationInclude = controller.slice(
    controller.indexOf("const conversationInclude = {"),
    controller.indexOf("function clean(value, max, fallback"),
  );
  // A restrictive `select` would have silently dropped the new column —
  // confirming this block only ever uses relation-shaped keys (include
  // semantics), never a top-level `select:`, is what guarantees
  // clientLastReadAt rides along automatically.
  assert.doesNotMatch(conversationInclude, /^\s*select:/m);
  assert.match(controller, /async function scopedConversation\(req, id, include = conversationInclude\)/);
});
