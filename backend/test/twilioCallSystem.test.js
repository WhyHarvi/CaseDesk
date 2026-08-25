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
  const [service, webhookController] = await Promise.all([
    source("../src/services/twilioCallService.js"),
    source("../src/controllers/twilioWebhookController.js"),
  ]);
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
  // Inbound <Client> events must retain the parent PSTN leg's caller number.
  // Twilio does not reliably include ParentCallSid on those child callbacks,
  // so inboundTwiML explicitly threads the stable context through the URL.
  assert.match(service, /parentCallSid=\$\{encodeURIComponent\(parentCallSid\)\}/);
  assert.match(service, /callerNumber=\$\{encodeURIComponent\(inboundCallerNumber\)\}/);
  assert.match(service, /body\.parentCallSid \|\| body\.ParentCallSid/);
  assert.match(service, /explicitInboundCaller \|\| body\.From/);
  assert.match(webhookController, /\{ \.\.\.\(req\.body \|\| \{\}\), \.\.\.\(req\.query \|\| \{\}\) \}/);
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
  // Live controls must not fail merely because the asynchronous history
  // callback is late or a sibling leg made the stored status look stale.
  assert.match(service, /const LIVE_TWILIO_CALL_STATUSES = new Set\(\["queued", "ringing", "in-progress"\]\)/);
  assert.match(service, /await client\.calls\(candidate\)\.fetch\(\)/);
  assert.match(service, /activeTwilioCall\(agencyId, callSid, "transfer", config\)/);
  assert.match(service, /activeTwilioCall\(agencyId, callSid, "record", config\)/);
  assert.match(service, /rawPayload: \{ path: \["parentCallSid"\], equals: callSidClean \}/);
  // The transfer target's <Client> carries session.providerCallId through as
  // a ParentCallSid parameter — the same hand-off inboundTwiML uses — so the
  // person transferred to can themselves transfer or record afterward.
  assert.match(service, /<Client>\$\{escapeXml\(clientIdentity\(target\.id\)\)\}<Parameter name="ParentCallSid" value="\$\{escapeXml\(session\.providerCallId\)\}"\/><\/Client>/);
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
  assert.match(service, /digits\.length > 10 \? digits\.slice\(-10\)/);
  assert.match(service, /prisma\.client\.findMany/);
  assert.match(service, /prisma\.lead\.findMany/);
  assert.match(controller, /export async function issueTwilioCallToken/);
  assert.match(controller, /export async function createTwilioVoiceLine/);
  assert.match(controller, /export async function transferCall/);
  assert.match(controller, /export async function syncTwilioCallHistoryHandler/);
  assert.match(controller, /export async function saveActiveTwilioCallNote/);
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
  assert.match(callRoutes, /router\.put\("\/active-note", asyncHandler\(saveActiveTwilioCallNote\)\)/);
  assert.match(callRoutes, /router\.get\("\/staff"/);
  // Twilio itself fetches the TwiML endpoints — they are public on purpose
  // and carry the agency id in the path, never auth.
  assert.match(webhookRoutes, /router\.post\("\/twilio\/inbound\/:agencyId"/);
  assert.match(webhookRoutes, /router\.post\("\/twilio\/outbound\/:agencyId"/);
  assert.match(webhookRoutes, /router\.post\("\/twilio\/status\/:agencyId"/);
});

test("settings saves and reports the voice fields (API key, calls toggle, test status)", async () => {
  const controller = await source("../src/controllers/twilioSettingsController.js");
  assert.match(controller, /const apiKeySid = body\.apiKeySid !== undefined \? clean\(body\.apiKeySid, 64\) : existing\?\.apiKeySid \|\| "";/);
  // The account-credentials card and the voice card are two separate forms
  // that each PUT only their own fields — saving one must not blank out or
  // reject on the fields only the other form sends. A field falls back to
  // its existing saved value when the request omits it entirely, and is
  // only cleared when the request explicitly sends a falsy value for it.
  assert.match(controller, /callsEnabled: body\.callsEnabled !== undefined \? body\.callsEnabled === true : Boolean\(existing\?\.callsEnabled\)/);
  assert.match(controller, /voiceNumber: voiceNumber \|\| null/);
  assert.match(controller, /if \(values\.callsEnabled && !existing\?\.apiKeySecretEncrypted && !suppliedApiKeySecret\)/);
  assert.match(controller, /apiKeySecretEncrypted/);
  assert.match(controller, /lastCallTestStatus/);
  assert.match(controller, /function validate\(body, existing\)/);
  assert.match(controller, /const values = validate\(req\.body, existing\);/);
});

test("lead calls auto-record: the softphone dial threads the lead id through TwiML into the status callback", async () => {
  const service = await source("../src/services/twilioCallService.js");
  // The dial's custom leadId/clientId params are forwarded onto the status
  // callback URL, which Twilio echoes back into the callback POST body — so
  // the session links to the lead even when the number alone is ambiguous.
  assert.match(service, /const dialLeadId = clean\(req\.body\?\.leadId, 100\);/);
  assert.match(service, /leadId=\$\{encodeURIComponent\(dialLeadId\)\}/);
  assert.match(service, /const explicitLeadId = clean\(body\.leadId, 100\) \|\| null;/);
  // Only an agency-verified lead/client id is ever applied, and it only fills
  // an unlinked session — it never overrides a match the number produced.
  assert.match(service, /tx\.lead\.findFirst\(\{ where: \{ id: explicitLeadId, agencyId, deletedAt: null }/);
  assert.match(service, /linkLeadId && !existing\.leadId \? \{ leadId: linkLeadId, resolution: "LINKED_LEAD"/);
  // statusBase's query string joins agent=/leadId=/clientId= with a raw "&"
  // — correct for a URL, but a bare "&" inside an XML attribute value reads
  // as an unterminated entity reference and Twilio's TwiML parser rejects
  // the whole document (confirmed via Twilio's own debugger: "the reference
  // to entity 'leadId' must end with the ';' delimiter"), so every call
  // carrying a lead/client id failed outright with a generic "application
  // error" and never got dialed or logged. Every statusCallback attribute
  // built from a multi-param URL must XML-escape it, not just URL-encode
  // the individual param values.
  const escapedStatusCallbackCount = (service.match(/statusCallback="\$\{escapeXml\(statusBase\)\}"/g) || []).length;
  assert.equal(escapedStatusCallbackCount, 4, "every statusBase-built statusCallback attribute (inboundTwiML, outboundTwiML's internal-line branch, outboundTwiML's external-number branch, and transferTwilioCall) must be XML-escaped");
});

test("the 'call ended' popup saves the outcome through a shared applyCallOutcome path", async () => {
  const [service, controller, oomaController, routes] = await Promise.all([
    source("../src/services/oomaCallService.js"),
    source("../src/controllers/twilioCallController.js"),
    source("../src/controllers/oomaCallController.js"),
    source("../src/routes/twilioCallRoutes.js"),
  ]);
  // The outcome + follow-up logic is shared by the history drawer (Ooma
  // routes) and the softphone popup (Twilio routes) so both write identically.
  assert.match(service, /export async function applyCallOutcome\(call, \{ outcome, notes, nextFollowUp = null } = \{\}, \{ agencyId, userId }/);
  assert.match(service, /CALL_OUTCOMES\.has\(value\)/);
  assert.match(service, /leadFollowUp\.create/);
  // The popup endpoint finds the session by the SDK CallSid and, when the
  // status callback hasn't landed yet, creates a minimal linked session.
  assert.match(controller, /export async function recordOutboundCallOutcome\(req, res\)/);
  assert.match(controller, /rawPayload: \{ path: \["callSid"\], equals: providerCallId }/);
  assert.match(controller, /createdByOutcomePopup: true/);
  assert.match(controller, /const outcomeInput = \{ \.\.\.req\.body, notes: clean\(req\.body\?\.notes, 3000\) \|\| call\.outcomeNotes \|\| "" };/);
  assert.match(controller, /await applyCallOutcome\(call, outcomeInput, \{ agencyId, userId: req\.user\.id }/);
  // The Ooma drawer's outcome handler now routes through the same helper.
  assert.match(oomaController, /await applyCallOutcome\(call, req\.body, \{ agencyId: req\.auth\.agencyId, userId: req\.auth\.userId }/);
  assert.doesNotMatch(oomaController, /const allowed = new Set\(\["COMPLETED"/);
  assert.match(routes, /router\.post\("\/outcome", asyncHandler\(recordOutboundCallOutcome\)\)/);
});

test("the clients UI calls clients through the softphone too, with the same outcome popup", async () => {
  const [clientsPage, profilePage] = await Promise.all([
    source("../../frontend/src/pages/Clients.jsx"),
    source("../../frontend/src/pages/ClientProfile.jsx"),
  ]);
  // List rows (desktop + mobile cards) dial with the client record context.
  assert.match(clientsPage, /import \{ useSoftphone } from "\.\.\/components\/calls\/SoftphoneProvider";/);
  assert.match(clientsPage, /await dial\(client\.phone, \{ clientId: client\.id, clientName: client\.fullName }/);
  assert.match(clientsPage, /disabled=\{softphoneStatus !== "ready"}/);
  assert.match(clientsPage, /onCall=\{\(\) => startCall\(client\)}/);
  // Profile header phone action dials through the softphone when ready.
  assert.match(profilePage, /useSoftphone\(\)/);
  assert.match(profilePage, /await dial\(client\.phone, \{ clientId: client\.id, clientName: client\.fullName }/);
  assert.match(profilePage, /onClick=\{softphoneStatus === "ready" && client\.phone \? startClientCall : undefined}/);
  // The popup keeps the follow-up option lead-only — client calls record the
  // outcome on the call and the client's communication thread instead.
  const provider = await source("../../frontend/src/components/calls/SoftphoneProvider.jsx");
  assert.match(provider, /\/\* Follow-ups are a lead concept/);
});

test("the leads UI calls leads through the softphone and pops the outcome card on hang-up only", async () => {
  const [provider, leadsPage, detailSheet] = await Promise.all([
    source("../../frontend/src/components/calls/SoftphoneProvider.jsx"),
    source("../../frontend/src/modules/leads/pages/LeadsPage.jsx"),
    source("../../frontend/src/modules/leads/components/LeadDetailSheet.jsx"),
  ]);
  // dial() accepts the record context, passes the ids to Twilio as custom
  // params, and remembers them so the ended-call popup can autofill + save.
  assert.match(provider, /const dial = useCallback\(async \(number, context = \{\}\) =>/);
  assert.match(provider, /leadId: context\.leadId/);
  assert.match(provider, /const payload = \{ number: target, callSid: call\.parameters\?\.CallSid \|\| "", durationSeconds, \.\.\.dialContextRef\.current };/);
  assert.match(provider, /setEndedCall\(payload\);/);
  // The popup itself: autofilled details, outcome + note, optional follow-up.
  assert.match(provider, /function EndedCallCard\(\{ ended, onClose }/);
  assert.match(provider, /api\.post\("\/twilio-calls\/outcome"/);
  assert.match(provider, /nextFollowUp: \{ dueAt: new Date\(dueAt\)\.toISOString\(\)/);
  // Incoming calls never trigger it — only calls WE placed do: the popup is
  // only armed by the outbound dial path and is suppressed while an incoming
  // call is showing.
  assert.match(provider, /call\.on\("disconnect", \(\) => finish\(true\)\);/);
  assert.match(provider, /endedCall && !active && !incoming/);
  assert.doesNotMatch(provider, /call\.on\("disconnect", \(\) => \{\s*setEndedCall/);
  // The leads list gains a per-row call button; the detail sheet dials too.
  assert.match(leadsPage, /import \{ useSoftphone } from "\.\.\/\.\.\/\.\.\/components\/calls\/SoftphoneProvider";/);
  assert.match(leadsPage, /await dial\(lead\.phone, \{ leadId: lead\.id, leadName: leadName\(lead\) }/);
  assert.match(leadsPage, /stopPropagation\(\); startCall\(lead\)/);
  assert.match(detailSheet, /useSoftphone\(\)/);
  assert.match(detailSheet, /await dial\(lead\.phone, \{ leadId: lead\.id, leadName: leadName\(lead\) }/);
  // Adjacent call and close controls remain distinct touch targets, and the
  // decorative call pulse cannot intercept a close tap.
  assert.match(detailSheet, /flex shrink-0 items-center gap-4/);
  assert.match(detailSheet, /pointer-events-none absolute -inset-1/);
  assert.match(detailSheet, /className="flex h-11 w-11 shrink-0/);
});

test("the frontend mounts a real softphone provider and a Call center page", async () => {
  const [provider, dialpad, callsPage, main, routes, panel] = await Promise.all([
    source("../../frontend/src/components/calls/SoftphoneProvider.jsx"),
    source("../../frontend/src/components/calls/GlobalDialpad.jsx"),
    source("../../frontend/src/pages/CallsPage.jsx"),
    source("../../frontend/src/main.jsx"),
    source("../../frontend/src/routes/AppRoutes.jsx"),
    source("../../frontend/src/components/settings/AgencyTwilioSettingsPanel.jsx"),
  ]);
  assert.match(provider, /import \{ Device \} from "@twilio\/voice-sdk";/);
  assert.match(provider, /device\.on\("incoming"/);
  assert.match(provider, /device\.connect\(\{\s*params: \{\s*To: target/);
  assert.match(provider, /device\.updateToken\(response\.data\?\.data\?\.token\)/);
  assert.match(provider, /export function useSoftphone\(\)/);
  assert.match(callsPage, /export default function CallsPage\(\)/);
  assert.match(callsPage, /"history", "History", History/);
  assert.match(callsPage, /openGlobalDialpad/);
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
  // The global dialpad's in-call screen exposes transfer and the picker
  // fetches transferable staff — the active-call UI lives there, not on the
  // softphone provider, so it shares one phone surface instead of two
  // competing floating widgets.
  assert.match(dialpad, /twilio-calls\/transfer/);
  assert.match(dialpad, /twilio-calls\/staff/);
  assert.match(dialpad, /function TransferPicker\(/);
  // Notes opens for every active call. Known numbers save to the matching
  // Lead/Client; unknown numbers fall back to the shared call-history row.
  assert.match(dialpad, /const callNoteTarget = useMemo/);
  assert.match(dialpad, /api\.put\("\/twilio-calls\/active-note"/);
  assert.match(dialpad, /label="Notes" onClick=\{\(\) => setShowCallNotes\(true\)\} \/>/);
  assert.doesNotMatch(dialpad, /label="Notes"[^>]+disabled=\{!linkedRecord\}/);
});
