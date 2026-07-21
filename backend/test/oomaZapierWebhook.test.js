import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (relativePath) =>
  readFile(new URL(relativePath, import.meta.url), "utf8");

test("admins can generate an inbound Zapier webhook without direct Ooma credentials", async () => {
  const [schema, migration, controller, panel] = await Promise.all([
    source("../prisma/schema.prisma"),
    source("../prisma/migrations/20260721150000_ooma_zapier_webhook_only/migration.sql"),
    source("../src/controllers/oomaSettingsController.js"),
    source("../../frontend/src/components/settings/AgencyOomaSettingsPanel.jsx"),
  ]);

  assert.match(schema, /apiBaseUrl\s+String\?/);
  assert.match(schema, /apiKeyEncrypted\s+String\?/);
  assert.match(schema, /fromNumber\s+String\?/);
  assert.match(migration, /ALTER COLUMN "api_base_url" DROP NOT NULL/);
  assert.match(controller, /agencyOomaSettings\.upsert/);
  assert.match(controller, /apiBaseUrl: ""/);
  assert.match(controller, /apiKeyEncrypted: ""/);
  assert.match(controller, /fromNumber: ""/);
  assert.match(controller, /smsEnabled: false/);
  assert.match(controller, /callsEnabled: false/);
  assert.doesNotMatch(controller, /Save the Ooma connection before generating a webhook URL/);
  assert.match(panel, /Generate Zapier webhook URL/);
  assert.match(panel, /Direct Ooma API credentials are not required/);
});

test("the public token route accepts the normalized Zapier SMS payload", async () => {
  const [routes, controller, server, panel] = await Promise.all([
    source("../src/routes/communicationWebhookRoutes.js"),
    source("../src/controllers/communicationWebhookController.js"),
    source("../src/server.js"),
    source("../../frontend/src/components/settings/AgencyOomaSettingsPanel.jsx"),
  ]);

  assert.match(routes, /router\.post\("\/ooma\/:token"/);
  assert.match(server, /app\.use\("\/api\/communications\/webhooks", communicationWebhookRoutes\)/);
  assert.match(controller, /payload\.from/);
  assert.match(controller, /payload\.to/);
  assert.match(controller, /payload\.body/);
  assert.match(controller, /payload\.messageId/);
  assert.match(panel, /"event": "message\.received"/);
  assert.match(panel, /"channel": "Sms"/);
  assert.match(panel, /<strong>Payload type:<\/strong> JSON/);
});

test("webhook-only records are not treated as outbound Ooma connections", async () => {
  const [service, controller] = await Promise.all([
    source("../src/services/agencyOomaService.js"),
    source("../src/controllers/oomaSettingsController.js"),
  ]);

  assert.match(service, /settings\?\.apiBaseUrl/);
  assert.match(service, /storedConfig\(settings\) \|\| environmentConfig\(\)/);
  assert.match(controller, /const directConfigured = Boolean/);
  assert.match(controller, /configured: directConfigured/);
});
