import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("agencies can save Twilio credentials before a phone number exists", async () => {
  const [schema, migration, controller] = await Promise.all([
    source("../prisma/schema.prisma"),
    source("../prisma/migrations/20260821180000_add_agency_twilio_settings/migration.sql"),
    source("../src/controllers/twilioSettingsController.js"),
  ]);
  assert.match(schema, /model AgencyTwilioSettings/);
  assert.match(schema, /accountSid\s+String\?/);
  assert.match(schema, /authTokenEncrypted\s+String\?/);
  assert.match(schema, /fromNumber\s+String\?/);
  assert.match(schema, /messagingServiceSid\s+String\?/);
  assert.match(schema, /twilioSettings\s+AgencyTwilioSettings\?/);
  // The number columns must stay nullable — credentials should save today
  // with no number yet.
  assert.match(migration, /CREATE TABLE "agency_twilio_settings"/);
  assert.doesNotMatch(migration, /"from_number" TEXT NOT NULL/);
  assert.doesNotMatch(migration, /"account_sid" TEXT NOT NULL/);
  // The controller does not force a number to be present to save.
  assert.match(controller, /fromNumber: fromNumber \|\| null,/);
  assert.match(controller, /messagingServiceSid: messagingServiceSid \|\| null,/);
  assert.match(controller, /encryptSecret\(suppliedToken\)/);
});

test("credential verification works without a phone number", async () => {
  const [service, routes, controller] = await Promise.all([
    source("../src/services/agencyTwilioService.js"),
    source("../src/routes/settingsRoutes.js"),
    source("../src/controllers/twilioSettingsController.js"),
  ]);
  assert.match(service, /export async function verifyAgencyTwilioCredentials/);
  assert.match(service, /accounts\(accountSid\)\.fetch\(\)/);
  assert.match(routes, /router\.post\("\/twilio\/verify", asyncHandler\(verifyTwilioCredentials\)\)/);
  assert.match(controller, /export async function verifyTwilioCredentials/);
  // Verification only requires the account/token to already be saved — it
  // never checks fromNumber or messagingServiceSid.
  const verifyBody = controller.slice(controller.indexOf("export async function verifyTwilioCredentials"), controller.indexOf("export async function testTwilioSms"));
  assert.doesNotMatch(verifyBody, /fromNumber/);
});

test("SMS sends require Twilio and never fall back to another provider", async () => {
  const [provider, twilioService, outbox] = await Promise.all([
    source("../src/services/communicationProviderService.js"),
    source("../src/services/agencyTwilioService.js"),
    source("../src/services/communicationOutboxService.js"),
  ]);
  assert.match(provider, /export async function sendSmsMessage\(\{ agencyId, to, body, idempotencyKey, requireVerified = true \}\)/);
  assert.match(provider, /resolveAgencyTwilioConfig\(agencyId, \{ requireVerified \}\)/);
  assert.match(provider, /return sendAgencyTwilioSms\(/);
  assert.doesNotMatch(provider, /Ooma|sendAgencyOomaSms/);
  assert.match(twilioService, /Twilio is not connected/);
  assert.match(outbox, /sendSmsMessage/);
  assert.doesNotMatch(outbox, /sendOomaSms/);
});

test("Twilio settings can be removed", async () => {
  const controller = await source("../src/controllers/twilioSettingsController.js");
  assert.match(controller, /export async function deleteTwilioSettings/);
  assert.match(controller, /agencyTwilioSettings\.delete\(\{ where: \{ id: existing\.id \} \}\)/);
});

test("automated SMS call sites route through the Twilio-backed dispatcher", async () => {
  const files = [
    "../src/modules/leads/lead.retainer.service.js",
    "../src/modules/leads/lead.welcomeEmail.service.js",
    "../src/modules/leads/lead.staleOutreach.service.js",
    "../src/services/paymentNotificationService.js",
    "../src/services/automatedReminderService.js",
    "../src/services/bookingNotificationService.js",
    "../src/services/expiringDocumentReminderService.js",
    "../src/services/notificationDeliveryService.js",
    "../src/services/preConsultationIntakeService.js",
    "../src/services/bookingWaitlistService.js",
  ];
  const sources = await Promise.all(files.map((file) => source(file)));
  sources.forEach((src, index) => {
    assert.match(src, /sendSmsMessage/, `${files[index]} should import sendSmsMessage`);
    assert.doesNotMatch(src, /sendAgencyOomaSms/, `${files[index]} should not call a removed provider`);
  });
});

test("frontend registers Twilio as the sole phone and SMS provider", async () => {
  const [settingsPage, twilioPanel] = await Promise.all([
    source("../../frontend/src/pages/Settings.jsx"),
    source("../../frontend/src/components/settings/AgencyTwilioSettingsPanel.jsx"),
  ]);
  assert.match(settingsPage, /import AgencyTwilioSettingsPanel from "\.\.\/components\/settings\/AgencyTwilioSettingsPanel";/);
  assert.match(settingsPage, /activeSection === "agency-phone" \? \(\s*\n\s*<div className="space-y-6">\s*\n\s*<AgencyTwilioSettingsPanel \/>/);
  assert.match(twilioPanel, /Verify credentials/);
  assert.match(twilioPanel, /settings\/twilio\/verify/);
  assert.match(twilioPanel, /Send test text/);
  assert.match(twilioPanel, /disabled=\{!form\.sendReady\}/);
  assert.doesNotMatch(settingsPage, /AgencyOomaSettingsPanel|Ooma Enterprise/);
});
