import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("Twilio voice schema and migrations add API key, toggles, lines, and a shared provider column", async () => {
  const [schema, migration, linesMigration] = await Promise.all([
    source("../prisma/schema.prisma"),
    source("../prisma/migrations/20260821220000_add_twilio_voice/migration.sql"),
    source("../prisma/migrations/20260821230000_add_twilio_voice_lines/migration.sql"),
  ]);
  assert.match(schema, /apiKeySid\s+String\?\s+@map\("api_key_sid"\)/);
  assert.match(schema, /apiKeySecretEncrypted\s+String\?/);
  assert.match(schema, /callsEnabled\s+Boolean\s+@default\(false\)\s+@map\("calls_enabled"\)/);
  assert.match(schema, /voiceNumber\s+String\?\s+@map\("voice_number"\)/);
  assert.match(schema, /twimlAppSid\s+String\?\s+@map\("twiml_app_sid"\)/);
  // Both Ooma (Zapier) and Twilio calls share one history inbox — the session
  // row records which provider produced it.
  assert.match(schema, /provider\s+String\s+@default\("OOMA"\)/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "api_key_sid" TEXT/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "calls_enabled" BOOLEAN NOT NULL DEFAULT false/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "provider" TEXT NOT NULL DEFAULT 'OOMA'/);
  // Voice lines: per-number routing (frontdesk-only, all staff, internal).
  assert.match(schema, /model AgencyTwilioVoiceLine/);
  assert.match(schema, /routing\s+String\s+@default\("STAFF"\)\s+@map\("routing"\)/);
  assert.match(schema, /numberSid\s+String\s+@unique\s+@map\("number_sid"\)/);
  assert.match(schema, /twilioVoiceLines\s+AgencyTwilioVoiceLine\[\]/);
  assert.match(linesMigration, /CREATE TABLE "agency_twilio_voice_line"/);
  assert.match(linesMigration, /"routing" TEXT NOT NULL DEFAULT 'STAFF'/);
});

test("the Twilio call service issues Voice-grant access tokens and bridges TwiML", async () => {
  const service = await source("../src/services/twilioCallService.js");
  assert.match(service, /export async function issueTwilioAccessToken/);
  assert.match(service, /new AccessToken\(config\.accountSid, config\.apiKeySid, config\.apiKeySecret/);
  assert.match(service, /incomingAllow: true/);
  assert.match(service, /outgoingApplicationSid: config\.twimlAppSid/);
  // Inbound rings every registered staff softphone; outbound bridges the
  // browser client to the external number using the agency number as callerId.
  assert.match(service, /export async function inboundTwiML/);
  assert.match(service, /<Client>/);
  assert.match(service, /export async function outboundTwiML/);
  assert.match(service, /Dial callerId=/);
});

test("status callbacks ingest into the shared call history and distinguish missed calls", async () => {
  const service = await source("../src/services/twilioCallService.js");
  assert.match(service, /export async function handleTwilioCallStatus/);
  assert.match(service, /oomaCallSession\.create/);
  assert.match(service, /TWILIO_CALL_PROVIDER/);
  // A Dial child leg reports "completed" even when nobody picked up — the
  // DialCallStatus is what tells a missed call apart from a completed one.
  assert.match(service, /twilioCallStatus\(body\.CallStatus, body\.DialCallStatus\)/);
  assert.match(service, /if \(\["busy", "no-answer", "canceled", "cancelled"\].includes\(dial\)\) return "MISSED"/);
  // The client identity Twilio reports ("client:casedesk:<userId>") is
  // normalized back to the raw userId for handledByUserId.
  assert.match(service, /replace\(\/\^client:\/, ""\)\.replace\(\/\^casedesk:\/, ""\)/);
});

test("voice lines route inbound calls to their group and the internal line bridges staff calls", async () => {
  const service = await source("../src/services/twilioCallService.js");
  assert.match(service, /export async function provisionTwilioVoiceLine/);
  assert.match(service, /export async function listAgencyTwilioVoiceLines/);
  assert.match(service, /export async function updateTwilioVoiceLine/);
  assert.match(service, /export async function deleteTwilioVoiceLine/);
  // The inbound handler takes the line id and only rings that line's group.
  assert.match(service, /export async function inboundTwiML\(agencyId, lineId, req\)/);
  assert.match(service, /if \(line\.routing === "FRONTDESK"\) roles = \["frontdesk"\];/);
  // Dialing the internal office line rings the whole team instead of an
  // external number; transfers ring the target agent's softphone directly.
  assert.match(service, /routing: "INTERNAL", enabled: true/);
  assert.match(service, /export async function transferTwilioCall/);
  assert.match(service, /\.calls\(session\.providerCallId\)\.update\(\{ twiml \}\)/);
  assert.match(service, /<Client>\$\{escapeXml\(clientIdentity\(target\.id\)\)\}<\/Client>/);
  assert.match(service, /export async function listTwilioCallableStaff/);
  // The per-line webhook path is wired for Twilio to fetch.
  const webhookRoutes = await source("../src/routes/communicationWebhookRoutes.js");
  assert.match(webhookRoutes, /router\.post\("\/twilio\/inbound\/:agencyId\/:lineId"/);
});

test("history sync and address book back the Call center without exposing secrets", async () => {
  const [service, controller] = await Promise.all([
    source("../src/services/twilioCallService.js"),
    source("../src/controllers/twilioCallController.js"),
  ]);
  assert.match(service, /export async function syncTwilioCallHistory/);
  assert.match(service, /export async function listTwilioAddressBook/);
  assert.match(service, /prisma\.client\.findMany/);
  assert.match(service, /prisma\.lead\.findMany/);
  assert.match(controller, /export async function issueTwilioCallToken/);
  assert.match(controller, /export async function createTwilioVoiceLine/);
  assert.match(controller, /export async function transferCall/);
  assert.match(controller, /export async function syncTwilioCallHistoryHandler/);
});

test("auth routes and public webhooks are both wired into the server", async () => {
  const [server, callRoutes, webhookRoutes] = await Promise.all([
    source("../src/server.js"),
    source("../src/routes/twilioCallRoutes.js"),
    source("../src/routes/communicationWebhookRoutes.js"),
  ]);
  assert.match(server, /import twilioCallRoutes from "\.\/routes\/twilioCallRoutes\.js";/);
  assert.match(server, /"\/api\/twilio-calls"/);
  assert.match(callRoutes, /router\.post\("\/token", asyncHandler\(issueTwilioCallToken\)\)/);
  assert.match(callRoutes, /router\.get\("\/address-book"/);
  assert.match(callRoutes, /router\.get\("\/lines", asyncHandler\(listTwilioVoiceLines\)\)/);
  assert.match(callRoutes, /router\.post\("\/lines", asyncHandler\(createTwilioVoiceLine\)\)/);
  assert.match(callRoutes, /router\.patch\("\/lines\/:lineId"/);
  assert.match(callRoutes, /router\.delete\("\/lines\/:lineId"/);
  assert.match(callRoutes, /router\.post\("\/transfer"/);
  assert.match(callRoutes, /router\.get\("\/staff"/);
  // Twilio itself fetches the TwiML endpoints — they are public on purpose
  // and carry the agency id in the path, never auth.
  assert.match(webhookRoutes, /router\.post\("\/twilio\/inbound\/:agencyId"/);
  assert.match(webhookRoutes, /router\.post\("\/twilio\/outbound\/:agencyId"/);
  assert.match(webhookRoutes, /router\.post\("\/twilio\/status\/:agencyId"/);
});

test("settings saves and reports the voice fields (API key, calls toggle, test status)", async () => {
  const controller = await source("../src/controllers/twilioSettingsController.js");
  assert.match(controller, /const apiKeySid = clean\(body\.apiKeySid, 64\);/);
  assert.match(controller, /callsEnabled: body\.callsEnabled === true/);
  assert.match(controller, /voiceNumber: voiceNumber \|\| null/);
  assert.match(controller, /if \(values\.callsEnabled && !existing\?\.apiKeySecretEncrypted && !suppliedApiKeySecret\)/);
  assert.match(controller, /apiKeySecretEncrypted/);
  assert.match(controller, /lastCallTestStatus/);
});

test("the frontend mounts a real softphone provider and a Call center page", async () => {
  const [provider, callsPage, main, routes, panel] = await Promise.all([
    source("../../frontend/src/components/calls/SoftphoneProvider.jsx"),
    source("../../frontend/src/pages/CallsPage.jsx"),
    source("../../frontend/src/main.jsx"),
    source("../../frontend/src/routes/AppRoutes.jsx"),
    source("../../frontend/src/components/settings/AgencyTwilioSettingsPanel.jsx"),
  ]);
  assert.match(provider, /import \{ Device \} from "@twilio\/voice-sdk";/);
  assert.match(provider, /device\.on\("incoming"/);
  assert.match(provider, /device\.connect\(\{ params: \{ To: target \} \}\)/);
  assert.match(provider, /device\.updateToken\(response\.data\?\.data\?\.token\)/);
  assert.match(provider, /export function useSoftphone\(\)/);
  assert.match(callsPage, /export default function CallsPage\(\)/);
  assert.match(callsPage, /"history", "History", History/);
  assert.match(callsPage, /"dialpad", "Dialpad", PhoneCall/);
  assert.match(callsPage, /"address-book", "Address book", BookUser/);
  assert.match(callsPage, /CallHistorySection/);
  assert.match(main, /import \{ SoftphoneProvider \} from "\.\/components\/calls\/SoftphoneProvider";/);
  assert.match(main, /<SoftphoneProvider>/);
  assert.match(routes, /CallsPage/);
  // Settings gains the voice setup surface for the admin.
  assert.match(panel, /twilio-calls\/numbers/);
  assert.match(panel, /twilio-calls\/lines/);
  assert.match(panel, /twilio-calls\/test/);
  assert.match(panel, /API Key SID/);
  assert.match(panel, /Enable calling for this workspace/);
  assert.match(panel, /FRONTDESK/);
  assert.match(panel, /Internal line/);
  // The call bar exposes transfer and the picker fetches transferable staff.
  assert.match(provider, /twilio-calls\/transfer/);
  assert.match(provider, /twilio-calls\/staff/);
  assert.match(provider, /Transfer/);
});
