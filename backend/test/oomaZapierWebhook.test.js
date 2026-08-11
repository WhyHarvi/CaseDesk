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
  assert.match(panel, /Create CaseDesk connection/);
  assert.match(panel, /no Ooma API key is needed/i);
  assert.match(panel, /Last event received/);
  assert.match(panel, /Check connection/);
  assert.match(panel, /Required mapping for incoming SMS/);
  assert.match(panel, /remote number/);
  assert.match(panel, /api\.getFresh\("\/settings\/ooma"\)/);
});

test("the public token route accepts the normalized Zapier SMS payload", async () => {
  const [routes, controller, addresses, server, panel] = await Promise.all([
    source("../src/routes/communicationWebhookRoutes.js"),
    source("../src/controllers/communicationWebhookController.js"),
    source("../src/services/communicationAddressService.js"),
    source("../src/server.js"),
    source("../../frontend/src/components/settings/AgencyOomaSettingsPanel.jsx"),
  ]);

  assert.match(routes, /router\.post\("\/ooma\/:token"/);
  assert.match(server, /app\.use\("\/api\/communications\/webhooks", communicationWebhookRoutes\)/);
  assert.match(controller, /payload\.from/);
  assert.match(controller, /payload\.to/);
  assert.match(controller, /payload\.body/);
  assert.match(controller, /payload\.messageId/);
  assert.match(controller, /resolveOomaSender/);
  assert.match(addresses, /payload\.remote_number/);
  assert.match(panel, /Inbound CaseDesk webhook URL/);
  assert.match(panel, /Paste this address into your Zapier webhook action/);
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

test("outbound CaseDesk SMS is sent to a separately configured Zapier Catch Hook", async () => {
  const [schema, migration, routes, controller, service, provider, panel] = await Promise.all([
    source("../prisma/schema.prisma"),
    source("../prisma/migrations/20260721170000_ooma_zapier_outbound/migration.sql"),
    source("../src/routes/settingsRoutes.js"),
    source("../src/controllers/oomaSettingsController.js"),
    source("../src/services/agencyOomaService.js"),
    source("../src/services/communicationProviderService.js"),
    source("../../frontend/src/components/settings/AgencyOomaSettingsPanel.jsx"),
  ]);

  assert.match(schema, /zapierOutboundWebhookEncrypted\s+String\?/);
  assert.match(migration, /zapier_outbound_webhook_encrypted/);
  assert.match(routes, /\/ooma\/zapier-outbound/);
  assert.match(routes, /zapier-outbound\/test-sms", rateLimit/);
  assert.match(controller, /zapierWebhookUrl/);
  assert.match(controller, /encryptSecret\(webhookUrl\)/);
  assert.match(controller, /testZapierOutboundSms/);
  assert.match(service, /event: "sms\.send"/);
  assert.match(service, /idempotencyKey/);
  assert.match(service, /provider: "Zapier \/ Ooma"/);
  assert.match(provider, /ooma\.Sms\.source === "Zapier"/);
  assert.match(panel, /Receive activity/);
  assert.match(panel, /Send messages/);
  assert.match(panel, /Save connection/);
  assert.doesNotMatch(panel, /Keep existing|Create new/);
  assert.doesNotMatch(panel, /API key from Ooma|API address from Ooma/);
});

test("Ooma calls have a durable event ledger, secured staff API, and working call inbox", async () => {
  const [schema, migration, webhook, service, server, routes, appRoutes, sidebar, page, settings] = await Promise.all([
    source("../prisma/schema.prisma"),
    source("../prisma/migrations/20260811120000_ooma_call_sessions/migration.sql"),
    source("../src/controllers/communicationWebhookController.js"),
    source("../src/services/oomaCallService.js"),
    source("../src/server.js"),
    source("../src/routes/oomaCallRoutes.js"),
    source("../../frontend/src/routes/AppRoutes.jsx"),
    source("../../frontend/src/components/layout/Sidebar.jsx"),
    source("../../frontend/src/pages/OomaCallsPage.jsx"),
    source("../../frontend/src/components/settings/AgencyOomaSettingsPanel.jsx"),
  ]);

  assert.match(schema, /model OomaCallSession/);
  assert.match(schema, /model OomaCallEvent/);
  assert.match(migration, /UNIQUE INDEX "ooma_call_sessions_agency_id_provider_call_id_key"/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(webhook, /isOomaCallPayload/);
  assert.match(webhook, /ingestOomaCallEvent/);
  assert.match(service, /providerEventId/);
  assert.match(service, /ensureOomaCallbackFollowUp/);
  assert.match(server, /"\/api\/ooma-calls"/);
  assert.match(server, /requirePortalPage\("leads"\)/);
  assert.match(routes, /\/create-lead/);
  assert.match(routes, /\/link-client/);
  assert.match(routes, /\/outcome/);
  assert.match(appRoutes, /path="\/calls"/);
  assert.match(sidebar, /label: "Calls"/);
  assert.match(page, /Create a lead from this caller/);
  assert.match(page, /href={`tel:/);
  assert.match(settings, /New Incoming Call/);
  assert.match(settings, /call_started/);
  assert.match(settings, /Call Ended/);
  assert.match(settings, /call_ended/);
});
