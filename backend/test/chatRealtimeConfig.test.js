import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("the authenticated client portal can fetch its own realtime chat config, scoped through its own case access", async () => {
  const [controller, routes] = await Promise.all([
    source("../src/controllers/portalController.js"),
    source("../src/routes/portalRoutes.js"),
  ]);

  // Two of the three chat surfaces already had this (staff via
  // getCommunicationRealtimeConfig, token-link inline in getClientChat) —
  // the authenticated portal was the one gap.
  assert.match(controller, /export async function getPortalRealtimeConfig\(req, res\) \{/);
  const fn = controller.slice(
    controller.indexOf("export async function getPortalRealtimeConfig"),
    controller.indexOf("export async function createPortalMessage"),
  );
  // Scoped through the client's own linked case, not a client-supplied
  // agencyId/caseId trusted as-is.
  assert.match(fn, /const link = await linkedClient\(req\);/);
  assert.match(fn, /await linkedCase\(req, link\.clientId, requestedCaseId\)/);
  assert.match(fn, /role: "client",/);
  // General (pre-case) chat has no case-scoped realtime topic — this must
  // degrade to "not configured", not throw or fabricate a topic.
  assert.match(fn, /: \{ configured: false \},/);
  assert.match(routes, /router\.get\("\/messages\/realtime", asyncHandler\(getPortalRealtimeConfig\)\);/);
});

test("all three chat surfaces broadcast over the same case-scoped realtime topic and none of them crash on a broadcast failure", async () => {
  const [communicationController, portalController, clientCommunicationController] = await Promise.all([
    source("../src/controllers/communicationController.js"),
    source("../src/controllers/portalController.js"),
    source("../src/controllers/clientCommunicationController.js"),
  ]);
  for (const controller of [communicationController, portalController, clientCommunicationController]) {
    assert.match(controller, /broadcastCaseCommunication/);
    // Every broadcast call is either awaited-and-caught or wrapped so a
    // Realtime outage can never fail the actual message send.
    assert.match(controller, /broadcastCaseCommunication\(\{[\s\S]{0,400}?\}\)\.catch\(/);
  }
});
