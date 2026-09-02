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
  // New sessions default to Twilio; legacy records remain readable.
  assert.match(schema, /provider\s+String\s+@default\("TWILIO"\)/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "api_key_sid" TEXT/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "calls_enabled" BOOLEAN NOT NULL DEFAULT false/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "provider" TEXT NOT NULL DEFAULT 'OOMA'/);
  // Voice lines: per-number routing (frontdesk-only, all staff, internal).
  assert.match(schema, /model AgencyTwilioVoiceLine/);
  assert.match(schema, /model AgencyTwilioVoiceLineAssignee/);
  assert.match(schema, /userId\s+String\s+@unique/);
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

// A network blip, laptop sleep/wake, or wifi/VPN switch can drop the Voice
// SDK's registration after it was already "ready" — without the fix, the
// dial button (gated only on status, not the separate registered flag)
// stayed clickable and calling threw "The softphone is not registered"
// instead of the button simply disabling until the SDK reconnects.
test("losing the Voice SDK's registration mid-session also takes the dial button out of \"ready\", not just the internal registered flag", async () => {
  const provider = await source("../../frontend/src/components/calls/SoftphoneProvider.jsx");
  assert.match(provider, /device\.on\("registered", \(\) => \{ if \(!disposed\) applyState\(\{ registered: true, status: "ready" \}\); \}\);/);
  assert.match(provider, /device\.on\("unregistered", \(\) => \{ if \(!disposed\) applyState\(\{ registered: false, status: "registering" \}\); \}\);/);

  const dialpad = await source("../../frontend/src/components/calls/GlobalDialpad.jsx");
  assert.match(dialpad, /const canCall = status === "ready" && digits\.length >= 7 && !active && !busy;/);
});

test("statusCallback/statusCallbackEvent live on <Client>/<Number>, never on <Dial> itself — Twilio's schema only allows them on the nested noun (Debugger warning 12200)", async () => {
  const service = await source("../src/services/twilioCallService.js");
  // outboundTwiML's internal-line branch: each <Client> carries its own
  // statusCallback, not the wrapping <Dial>. inboundTwiML no longer builds
  // <Client> tags at all — it dispatches ring attempts via the REST API
  // (dispatchRingAttempts) and bridges through <Enqueue>/<Dial><Queue>.
  const clientStatusCallbackCount = (service.match(/<Client statusCallback="\$\{escapeXml\(statusBase\)\}" statusCallbackEvent="initiated ringing answered completed">\$\{escapeXml\(identity\)\}<Parameter name="ParentCallSid"/g) || []).length;
  assert.equal(clientStatusCallbackCount, 1, "outboundTwiML's internal-line branch must put statusCallback on <Client>");
  // outboundTwiML's external-number branch: the bare dialed number is
  // wrapped in <Number> so statusCallback has a valid home; action/method
  // stay on <Dial> (still the authoritative outbound source). Keeping the
  // browser leg unanswered until the destination answers makes the SDK's
  // accept event—and therefore CaseDesk's call timer—represent a real answer.
  assert.match(service, /<Dial callerId="\$\{escapeXml\(outboundCallerId\)\}" timeout="30" answerOnBridge="true" action="\$\{escapeXml\(statusBase\)\}" method="POST"><Number statusCallback="\$\{escapeXml\(statusBase\)\}" statusCallbackEvent="initiated ringing answered completed">\$\{to\}<\/Number><\/Dial>/);
  // None of the real <Dial ...> opening tags carry statusCallback directly.
  // Strip line comments first — several of them describe this exact rule in
  // prose (mentioning "<Dial...>") and would otherwise pollute the match.
  const codeOnly = service.replace(/^\s*\/\/.*$/gm, "");
  const dialTags = codeOnly.match(/<Dial [^>]*>/g) || [];
  assert.ok(dialTags.length >= 3, "expected at least 3 <Dial ...> tags with attributes, across outbound/internal-line/transfer");
  for (const tag of dialTags) {
    assert.doesNotMatch(tag, /statusCallback=/, `<Dial> tag must not carry statusCallback directly: ${tag}`);
  }
  // dequeueTwiML's <Dial><Queue> bridge is a bare tag with no attributes at
  // all, so it can never carry statusCallback in the first place.
  assert.match(codeOnly, /<Dial><Queue>\$\{escapeXml\(queueName\)\}<\/Queue><\/Dial>/);
});

test("the status/action webhook always answers with a valid TwiML Content-Type, since it doubles as outboundTwiML's <Dial action> callback (Debugger error 12300 otherwise)", async () => {
  const controller = await source("../src/controllers/twilioWebhookController.js");
  const statusFn = controller.slice(controller.indexOf("export async function twilioCallStatus"));
  assert.match(statusFn, /res\.type\("text\/xml"\)\.send\("<Response><\/Response>"\)/);
  assert.doesNotMatch(statusFn, /res\.status\(200\)\.send\(\);/);
});

test("status callbacks ingest into the shared call history and distinguish missed calls", async () => {
  const [service, webhookController] = await Promise.all([
    source("../src/services/twilioCallService.js"),
    source("../src/controllers/twilioWebhookController.js"),
  ]);
  assert.match(service, /export async function handleTwilioCallStatus/);
  assert.match(service, /callSession\.create/);
  assert.match(service, /TWILIO_CALL_PROVIDER/);
  // A Dial child leg reports "completed" even when nobody picked up — the
  // DialCallStatus is what tells a missed call apart from a completed one.
  assert.match(service, /twilioCallStatus\(body\.CallStatus, body\.DialCallStatus\)/);
  assert.match(service, /if \(\["busy", "no-answer", "canceled", "cancelled"\].includes\(dial\)\) return "MISSED"/);
  // The client identity Twilio reports ("client:casedesk:<userId>") is
  // normalized back to the raw userId for handledByUserId.
  assert.match(service, /replace\(\/\^client:\/, ""\)\.replace\(\/\^casedesk:\/, ""\)/);
  // Inbound status callbacks must retain the parent PSTN leg's caller number.
  // Twilio does not reliably include ParentCallSid on those callbacks, so
  // inboundTwiML explicitly threads the stable context through the URL.
  assert.match(service, /parentCallSid=\$\{encodeURIComponent\(parentCallSid\)\}/);
  assert.match(service, /callerNumber=\$\{encodeURIComponent\(inboundCallerNumber\)\}/);
  // Each queue-dispatched ring attempt is never nested inside the caller's
  // own <Dial>, so it can't carry a TwiML <Parameter> the way the old
  // <Dial><Client> structure did — the caller number is persisted on the
  // CallRingDispatch row per attempt instead, for the answering browser to
  // look up by its own CallSid (see getIncomingCallContext).
  assert.match(service, /data: \{ agencyId, parentCallSid, dispatchedCallSid: call\.sid, identity, callerNumber: callerNumber \|\| null \}/);
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
  assert.match(service, /if \(line\.routing === "DIRECT"\)/);
  assert.match(service, /assignedUserIds = assignees\.map/);
  // A DIRECT assignment is offered as an explicit outbound choice, while
  // the workspace default remains the fallback. The webhook re-validates
  // the requested caller ID against the authenticated client identity.
  assert.match(service, /export async function issueTwilioAccessToken[\s\S]+outboundNumbersForUser\(agencyId, userId, config\.voiceNumber\)/);
  assert.match(service, /routing: "DIRECT",[\s\S]+assignments: \{ some: \{ userId \} \}/);
  assert.match(service, /let outboundCallerId = config\.voiceNumber/);
  assert.match(service, /const requestedCallerId = clean\(req\.body\?\.CallerId, 40\)/);
  assert.match(service, /assignments: \{ some: \{ userId: agentIdentity \} \}/);
  assert.match(service, /if \(assignedLine\) outboundCallerId = assignedLine\.phoneNumber/);
  assert.match(service, /voiceNumber: config\.voiceNumber/);
  assert.match(service, /outboundNumbers,/);
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
  assert.match(service, /<Client statusCallback="\$\{escapeXml\(statusBase\)\}" statusCallbackEvent="initiated ringing answered completed">\$\{escapeXml\(clientIdentity\(target\.id\)\)\}<Parameter name="ParentCallSid" value="\$\{escapeXml\(session\.providerCallId\)\}"\/><\/Client>/);
  assert.match(service, /export async function listTwilioCallableStaff/);
  // The per-line webhook path is wired for Twilio to fetch.
  const webhookRoutes = await source("../src/routes/communicationWebhookRoutes.js");
  assert.match(webhookRoutes, /router\.post\("\/twilio\/inbound\/:agencyId\/:lineId"/);
});

test("the default calling number is an explicit action — setPrimaryTwilioVoiceLine swaps isPrimary and the settings voiceNumber together, not just an accident of creation/deletion order", async () => {
  const [service, controller, routes] = await Promise.all([
    source("../src/services/twilioCallService.js"),
    source("../src/controllers/twilioCallController.js"),
    source("../src/routes/twilioCallRoutes.js"),
  ]);
  const fn = service.slice(service.indexOf("export async function setPrimaryTwilioVoiceLine"), service.indexOf("// ---- TwiML handlers"));
  assert.match(fn, /if \(!line\.enabled\) throw createHttpError\(400,/);
  assert.match(fn, /if \(line\.isPrimary\) return line;/);
  // Unsetting every other line's isPrimary and setting this one's must be
  // one atomic transaction — otherwise a crash mid-update could leave an
  // agency with zero (or two) primary lines.
  assert.match(fn, /prisma\.\$transaction\(\[/);
  assert.match(fn, /agencyTwilioVoiceLine\.updateMany\(\{ where: \{ agencyId, isPrimary: true \}, data: \{ isPrimary: false \} \}\)/);
  assert.match(fn, /agencyTwilioVoiceLine\.update\(\{ where: \{ id: line\.id \}, data: \{ isPrimary: true \} \}\)/);
  assert.match(fn, /agencyTwilioSettings\.update\(\{ where: \{ agencyId \}, data: \{ voiceNumber: line\.phoneNumber \} \}\)/);
  const controllerFn = controller.slice(controller.indexOf("export async function makeTwilioVoiceLinePrimary"), controller.indexOf("export async function removeTwilioVoiceLine"));
  assert.match(controllerFn, /requireAdmin\(req\);/);
  assert.match(controllerFn, /setPrimaryTwilioVoiceLine\(req\.user\.agencyId, req\.params\.lineId\)/);
  assert.match(routes, /router\.post\("\/lines\/:lineId\/primary", asyncHandler\(makeTwilioVoiceLinePrimary\)\)/);
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
  assert.equal(escapedStatusCallbackCount, 3, "every statusBase-built statusCallback attribute (outboundTwiML's internal-line branch, outboundTwiML's external-number branch, and transferTwilioCall) must be XML-escaped");
  // inboundTwiML no longer puts statusBase on a statusCallback attribute at
  // all — it's the <Enqueue action> that the caller's own queue result
  // fires back to — but the same XML-escaping requirement applies there too.
  assert.match(service, /<Enqueue waitUrl="\$\{escapeXml\(waitUrl\)\}" action="\$\{escapeXml\(statusBase\)\}">/);
});

test("the 'call ended' popup saves the outcome through a shared applyCallOutcome path", async () => {
  const [service, controller, historyController, routes] = await Promise.all([
    source("../src/services/callHistoryService.js"),
    source("../src/controllers/twilioCallController.js"),
    source("../src/controllers/callHistoryController.js"),
    source("../src/routes/twilioCallRoutes.js"),
  ]);
  // The outcome + follow-up logic is shared by history and the softphone.
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
  assert.match(historyController, /await applyCallOutcome\(call, req\.body, \{ agencyId: req\.auth\.agencyId, userId: req\.auth\.userId }/);
  assert.doesNotMatch(historyController, /const allowed = new Set\(\["COMPLETED"/);
  assert.match(routes, /router\.post\("\/outcome", asyncHandler\(recordOutboundCallOutcome\)\)/);
});

test("call details can prefill a booking, link the created appointment, and open WhatsApp", async () => {
  const [schema, migration, controller, routes, callsPage, calendarPage] = await Promise.all([
    source("../prisma/schema.prisma"),
    source("../prisma/migrations/20260831210000_link_calls_to_appointments/migration.sql"),
    source("../src/controllers/callHistoryController.js"),
    source("../src/routes/callHistoryRoutes.js"),
    source("../../frontend/src/pages/CallHistoryPage.jsx"),
    source("../../frontend/src/pages/CalendarPage.jsx"),
  ]);

  assert.match(schema, /appointmentId\s+String\?\s+@map\("appointment_id"\)/);
  assert.match(migration, /FOREIGN KEY \("appointment_id"\) REFERENCES "appointments"\("id"\)/);
  assert.match(controller, /export async function linkCallToAppointment/);
  assert.match(controller, /appointmentId: appointment\.id/);
  assert.match(routes, /router\.post\("\/:id\/link-appointment", asyncHandler\(linkCallToAppointment\)\)/);

  assert.match(callsPage, /Book appointment/);
  assert.match(callsPage, /bookForClient/);
  assert.match(callsPage, /bookForLead/);
  assert.match(callsPage, /bookFromCall/);
  assert.match(callsPage, /https:\/\/wa\.me\/\$\{whatsAppPhone\}/);
  assert.match(calendarPage, /setPrefillGuest/);
  assert.match(calendarPage, /api\.post\(`\/call-history\/\$\{linkingCallId\}\/link-appointment`/);
  assert.match(calendarPage, /onCreatedId=\{linkCreatedAppointmentToCall\}/);
});

test("call history SMS uses the default calling line and asks for a sender only when no default exists", async () => {
  const [controller, routes, twilio, smsSync, callsPage] = await Promise.all([
    source("../src/controllers/callHistoryController.js"),
    source("../src/routes/callHistoryRoutes.js"),
    source("../src/services/agencyTwilioService.js"),
    source("../src/services/twilioSmsSyncService.js"),
    source("../../frontend/src/pages/CallHistoryPage.jsx"),
  ]);

  assert.match(twilio, /const defaultNumber = primary \|\| settings\?\.voiceNumber \|\| settings\?\.fromNumber \|\| null/);
  assert.match(twilio, /requiresSelection: !defaultNumber && numbers\.length > 0/);
  assert.match(twilio, /fromNumber[\s\S]+\? \{ from: fromNumber \}/);
  assert.match(controller, /export async function getCallSmsOptions/);
  assert.match(controller, /export async function getCallSmsThread/);
  assert.match(controller, /export async function sendCallSms/);
  assert.match(controller, /requireCommunicationPermission\(req, "canSendSms"\)/);
  assert.match(controller, /if \(call\.clientId\) \{[\s\S]+assertClientCommunicationAllowed/);
  assert.match(controller, /assertClientCommunicationAllowed\([\s\S]+channel: "Sms"/);
  assert.match(controller, /metadata: \{ callHistoryId: call\.id \}/);
  assert.match(routes, /router\.get\("\/:id\/sms-options", asyncHandler\(getCallSmsOptions\)\)/);
  assert.match(routes, /router\.get\("\/:id\/sms-thread", asyncHandler\(getCallSmsThread\)\)/);
  assert.match(routes, /router\.post\("\/:id\/sms", asyncHandler\(sendCallSms\)\)/);
  assert.match(smsSync, /communicationMessage\.update\([\s\S]+status,[\s\S]+failureReason/);

  assert.match(callsPage, /initialMode=\{selectedMode\}/);
  assert.match(callsPage, /openCall\(call, "sms"\)/);
  assert.match(callsPage, /<ChatThread[\s\S]+messages=\{smsThread\.messages \|\| \[\]\}/);
  assert.match(callsPage, /\/app\/chats\?kind=sms&thread=/);
  assert.match(callsPage, /bg-sky-700[\s\S]+Match caller/);
  assert.match(smsSync, /export async function listAgencyTwilioSmsHistoryForNumber/);
  assert.match(callsPage, /No default calling number is set/);
  assert.match(callsPage, /Default calling number/);
  assert.match(callsPage, /Send SMS/);
});

test("call history reports who dialed, answered, or was rung instead of a generic team-member assignment", async () => {
  const [controller, callService, callsPage] = await Promise.all([
    source("../src/controllers/callHistoryController.js"),
    source("../src/services/twilioCallService.js"),
    source("../../frontend/src/pages/CallHistoryPage.jsx"),
  ]);

  assert.match(controller, /async function addEngagementSummaries/);
  assert.match(controller, /prisma\.callRingDispatch\.findMany/);
  assert.match(controller, /label: "Dialed by"/);
  assert.match(controller, /answeredCall \? "Answered by"[\s\S]+"Ringing"[\s\S]+"Rang"/);
  assert.match(controller, /const effectiveStatus = call\.status === "COMPLETED"[\s\S]+\? "MISSED" : call\.status/);
  assert.match(controller, /const data = await addEngagementSummaries\(matched, req\.auth\.agencyId\)/);
  assert.match(callService, /queueResult === "bridged" \? "COMPLETED" : "MISSED"/);
  assert.match(callService, /\["MISSED", "FAILED"\]\.includes\(existing\.status\)/);
  assert.match(callsPage, /function engagementSummary/);
  assert.match(callsPage, /if \(value === "COMPLETED"\) return "Answered"/);
  assert.match(callsPage, /function directionTone\(call\)/);
  assert.match(callsPage, /\["MISSED", "FAILED"\]\.includes\(call\.status\)[\s\S]+bg-rose-50 text-rose-700/);
  assert.match(callsPage, />Engagement<\/th>/);
  assert.doesNotMatch(callsPage, />Team member<\/th>/);
});

test("the clients UI calls clients through the softphone too, with the same outcome popup", async () => {
  const [clientsPage, profilePage] = await Promise.all([
    source("../../frontend/src/pages/Clients.jsx"),
    source("../../frontend/src/pages/ClientProfile.jsx"),
  ]);
  // List rows (desktop + mobile cards) open the shared dialpad with the
  // client record context so the caller ID can be selected before dialing.
  assert.match(clientsPage, /import \{ useSoftphone } from "\.\.\/components\/calls\/SoftphoneProvider";/);
  assert.match(clientsPage, /openGlobalDialpad\(client\.phone, \{ clientId: client\.id, clientName: client\.fullName }/);
  assert.match(clientsPage, /disabled=\{softphoneStatus !== "ready"}/);
  assert.match(clientsPage, /onCall=\{\(\) => startCall\(client\)}/);
  // Profile header phone action uses that same pre-call dialpad when ready.
  assert.match(profilePage, /useSoftphone\(\)/);
  assert.match(profilePage, /openGlobalDialpad\(client\.phone, \{ clientId: client\.id, clientName: client\.fullName }/);
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
  assert.match(provider, /leadId: recordContext\.leadId/);
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
  assert.match(leadsPage, /openGlobalDialpad\(lead\.phone, \{ leadId: lead\.id, leadName: leadName\(lead\) }/);
  assert.match(leadsPage, /stopPropagation\(\); startCall\(lead\)/);
  assert.match(detailSheet, /useSoftphone\(\)/);
  assert.match(detailSheet, /const number = lead\.phone;/);
  assert.match(detailSheet, /const context = \{ leadId: lead\.id, leadName: leadName\(lead\) \};/);
  assert.match(detailSheet, /onClose\(\);\s*window\.requestAnimationFrame\(\(\) => openGlobalDialpad\(number, context\)\);/);
  // Adjacent call and close controls remain distinct touch targets, and the
  // decorative call pulse cannot intercept a close tap.
  assert.match(detailSheet, /flex shrink-0 items-center gap-4/);
  assert.match(detailSheet, /pointer-events-none absolute -inset-1/);
  assert.match(detailSheet, /className="flex h-11 w-11 shrink-0/);
});

test("the frontend mounts a real softphone provider and a Call center page", async () => {
  const [provider, dialpad, callsPage, main, routes, panel, soundPreferences, soundPanel, settings, viteConfig, slider, soundSwitch] = await Promise.all([
    source("../../frontend/src/components/calls/SoftphoneProvider.jsx"),
    source("../../frontend/src/components/calls/GlobalDialpad.jsx"),
    source("../../frontend/src/pages/CallsPage.jsx"),
    source("../../frontend/src/main.jsx"),
    source("../../frontend/src/routes/AppRoutes.jsx"),
    source("../../frontend/src/components/settings/AgencyTwilioSettingsPanel.jsx"),
    source("../../frontend/src/utils/soundPreferences.js"),
    source("../../frontend/src/components/settings/SoundSettingsPanel.jsx"),
    source("../../frontend/src/pages/Settings.jsx"),
    source("../../frontend/vite.config.js"),
    source("../../frontend/src/components/ui/slider.jsx"),
    source("../../frontend/src/components/ui/switch.jsx"),
  ]);
  assert.match(provider, /import \{ Device \} from "@twilio\/voice-sdk";/);
  assert.match(provider, /device\.on\("incoming"/);
  assert.match(provider, /startConfiguredRingtone\(\{ loop: true \}\)/);
  assert.match(soundPreferences, /from "virtual:casedesk-sound-assets"/);
  assert.match(soundPreferences, /additionalAudio[\s\S]+\.setSinkId\(preferences\.additionalOutputId\)/);
  assert.match(soundPreferences, /audio\.volume = preferences\.ringtoneVolume \/ 100/);
  assert.match(viteConfig, /\["ringtones", "RINGTONE_ASSETS"\]/);
  assert.match(viteConfig, /\["notification-sounds", "NOTIFICATION_SOUND_ASSETS"\]/);
  assert.match(soundPanel, /Ringtone output/);
  assert.match(soundPanel, /Additional output/);
  assert.match(soundPanel, /Notification sounds/);
  assert.match(soundPanel, /selectAudioOutput/);
  assert.match(soundPanel, /onValueChange=\{\(next\) => onChange\(Array\.isArray\(next\) \? next\[0\] : next\)\}/);
  assert.match(soundPanel, /onCheckedChange=\{\(checked\) => save\(\{ notificationSoundsEnabled: Boolean\(checked\) \}\)\}/);
  assert.match(slider, /className="relative flex h-6 w-full touch-none cursor-pointer/);
  assert.match(soundSwitch, /data-\[checked\]:bg-primary/);
  assert.match(settings, /id: "sound"/);
  assert.match(settings, /<SoundSettingsPanel \/>/);
  // A nested <Dial><Client><Parameter> call (internal line) resolves who's
  // calling synchronously; a queue-dispatched ring has no <Parameter> to
  // read, so it waits on a backend lookup by its own dispatched CallSid
  // before ever showing the incoming-call UI (see getIncomingCallContext) —
  // showing it early would risk "Accept" sending the wrong CallSid.
  assert.match(provider, /call\.customParameters\?\.get\?\.\("CallerNumber"\) \|\| ""/);
  assert.match(provider, /if \(customFrom \|\| customParentSid\)/);
  assert.match(provider, /api\.get\(`\/twilio-calls\/incoming-context\/\$\{encodeURIComponent\(dispatchedCallSid\)\}`\)/);
  assert.match(provider, /showIncoming\(context\?\.callerNumber \|\| call\.parameters\?\.From \|\| "", context\?\.parentCallSid \|\| dispatchedCallSid\)/);
  assert.match(provider, /device\.connect\(\{\s*params: \{\s*To: target/);
  assert.match(provider, /call\.on\("ringing"/);
  assert.match(provider, /phase: "connected", connectedAt/);
  assert.match(dialpad, /if \(!callConnected\) return undefined/);
  assert.match(dialpad, /Date\.now\(\) - Number\(active\.connectedAt\)/);
  assert.match(provider, /device\.updateToken\(tokenData\.token\)/);
  assert.match(provider, /CallerId: outboundCallerId/);
  assert.match(provider, /casedesk:outbound-number:/);
  assert.match(dialpad, /Calling from/);
  assert.match(dialpad, /selectedOutboundNumber/);
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
  assert.match(panel, /ToggleGroupItem value="INTERNAL">Internal</);
  assert.match(panel, /function StaffAssignCombobox/);
  assert.match(panel, /assignedUserIds/);
  assert.match(panel, /Choose who receives inbound calls on each number/);
  assert.match(panel, /Assigning specific teammates does not change the number they call from/);
  // Which number is the default outbound caller ID is an explicit, per-line
  // action now (setPrimaryTwilioVoiceLine on the backend), not just an
  // accident of creation/deletion order.
  assert.match(panel, /twilio-calls\/lines\/\$\{line\.id\}\/primary/);
  assert.match(panel, /Set as default/);
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

test("per-agency call greetings: schema, settings validation/voice allow-list, and the shared voice constants", async () => {
  const [schema, migration, constants] = await Promise.all([
    source("../prisma/schema.prisma"),
    source("../prisma/migrations/20260901220000_add_agency_voice_greetings/migration.sql"),
    source("../src/constants/twilioVoices.js"),
  ]);
  assert.match(schema, /voiceGreetingText\s+String\?\s+@map\("voice_greeting_text"\)/);
  assert.match(schema, /voicemailGreetingText\s+String\?\s+@map\("voicemail_greeting_text"\)/);
  assert.match(schema, /ttsVoice\s+String\s+@default\("Polly\.Joanna-Neural"\)\s+@map\("tts_voice"\)/);
  assert.match(migration, /ADD COLUMN "voice_greeting_text" TEXT/);
  assert.match(migration, /ADD COLUMN "voicemail_greeting_text" TEXT/);
  assert.match(migration, /ADD COLUMN "tts_voice" TEXT NOT NULL DEFAULT 'Polly\.Joanna-Neural'/);
  // Amazon Polly neural voices, not Twilio's classic/robotic ones — this is
  // the single source of truth both the settings controller (validation +
  // the list it returns) and the TwiML builder (the default it falls back
  // to) import from, so they can never drift apart.
  assert.match(constants, /export const TTS_VOICES = \[/);
  assert.match(constants, /"Polly\.Joanna-Neural"/);
  assert.match(constants, /export const DEFAULT_TTS_VOICE = "Polly\.Joanna-Neural";/);
  assert.match(constants, /export const TTS_VOICE_IDS = new Set\(TTS_VOICES\.map\(\(voice\) => voice\.id\)\);/);

  const controller = await source("../src/controllers/twilioSettingsController.js");
  assert.match(controller, /import \{ DEFAULT_TTS_VOICE, MAX_CUSTOM_TUNE_SECONDS, TTS_VOICES, TTS_VOICE_IDS \} from "\.\.\/constants\/twilioVoices\.js";/);
  assert.match(controller, /availableTtsVoices: TTS_VOICES,/);
  // Capped at 300 chars to match twilioCallService.js's escapeXml, which
  // truncates there before rendering into <Say> — allowing a longer saved
  // value would let it silently get cut off mid-sentence when spoken.
  assert.match(controller, /clean\(body\.voiceGreetingText, 300\)/);
  assert.match(controller, /clean\(body\.voicemailGreetingText, 300\)/);
  assert.match(controller, /if \(!TTS_VOICE_IDS\.has\(ttsVoice\)\) throw createHttpError\(400, "Choose one of the available greeting voices\."\);/);
  // Same partial-update convention as the other two settings cards: falls
  // back to the existing saved value when the request omits the field.
  assert.match(controller, /const ttsVoice = body\.ttsVoice !== undefined \? clean\(body\.ttsVoice, 64\) : existing\?\.ttsVoice \|\| DEFAULT_TTS_VOICE;/);
});

test("inbound calls play the agency's greeting before ringing staff, and offer voicemail (with a recording) when nobody answers", async () => {
  const service = await source("../src/services/twilioCallService.js");
  // The greeting is entirely optional — omitted rather than forcing a
  // default script onto every workspace that hasn't set one.
  assert.match(service, /function sayTwiML\(settings, text\)/);
  assert.match(service, /if \(!body\) return "";/);
  // <Dial action> re-uses the same URL as the <Client> statusCallback — the
  // outbound flow's isDialAction check (DialCallStatus presence) is what
  // tells the two kinds of callback on that one URL apart.
  assert.match(service, /action="\$\{escapeXml\(statusBase\)\}" method="POST"/);
  // No staff/line configured falls straight to voicemail instead of just
  // hanging up.
  assert.match(service, /if \(!identities\.length\) return `<Response>\$\{greetingTwiML\}\$\{voicemailTwiML\(config\.settings, statusBase\)\}<\/Response>`;/);
  // The recording reuses statusBase as its recordingStatusCallback, so the
  // existing RecordingSid/RecordingUrl handling in handleTwilioCallStatus
  // (see its isRecording branch) attaches it to this same call session
  // automatically — no separate recording-handling path needed.
  assert.match(service, /function voicemailTwiML\(settings, statusBase\)/);
  assert.match(service, /<Record recordingStatusCallback="\$\{escapeXml\(statusBase\)\}" recordingStatusCallbackEvent="completed" maxLength="120" timeout="5" playBeep="true" trim="trim-silence"\/>/);
  assert.match(service, /export async function inboundVoicemailTwiML\(agencyId, callback, req\)/);

  const webhookController = await source("../src/controllers/twilioWebhookController.js");
  assert.match(webhookController, /\bhandleTwilioCallStatus,\s*\n\s*inboundTwiML,\s*\n\s*inboundVoicemailTwiML,/);
  // unansweredInboundDial (DialCallStatus + callerNumber) is now dormant for
  // inbound calls — ringing staff is an <Enqueue>, not a <Dial>, so it never
  // produces a DialCallStatus callback — but it's kept for outboundTwiML's
  // internal-line bridge (still a plain <Dial>) and any in-flight calls from
  // before the inbound flow moved to Queue.
  assert.match(
    webhookController,
    /const unansweredInboundDial =\s*\n\s*callback\.DialCallStatus !== undefined &&\s*\n\s*Boolean\(callback\.callerNumber\) &&\s*\n\s*!\["completed", "answered"\]\.includes\(dialCallStatus\);/,
  );
  // The caller's own <Enqueue action> callback (QueueResult) is inbound's
  // real "did anyone answer" signal now — it shares the same voicemail
  // fallback as the legacy unansweredInboundDial branch below it.
  assert.match(webhookController, /const isQueueResult = callback\.QueueResult !== undefined && Boolean\(callback\.callerNumber\);/);
  assert.equal((webhookController.match(/const voicemailXml = await inboundVoicemailTwiML\(req\.params\.agencyId, callback, req\);/g) || []).length, 2, "both the queue-result and the legacy unansweredInboundDial branches offer voicemail");
});

test("the Phone & SMS settings tab lets an admin type both greetings and pick the voice, gated on calling actually being enabled", async () => {
  const panel = await source("../../frontend/src/components/settings/AgencyTwilioSettingsPanel.jsx");
  assert.match(panel, /form\.configured && form\.callsEnabled \? \(/);
  assert.match(panel, /What callers hear/);
  assert.match(panel, /const saveGreetings = async \(event\) => \{/);
  assert.match(panel, /api\.put\("\/settings\/twilio", \{\s*\n\s*voiceGreetingText: voiceGreetingInput \|\| form\.voiceGreetingText,\s*\n\s*voicemailGreetingText: voicemailGreetingInput \|\| form\.voicemailGreetingText,\s*\n\s*whileWaitingGreetingText: whileWaitingGreetingInput \|\| form\.whileWaitingGreetingText,\s*\n\s*ttsVoice: ttsVoiceInput \|\| form\.ttsVoice,/);
  assert.match(panel, /\{\(form\.availableTtsVoices \|\| \[\]\)\.map\(\(voice\) => \(/);
  assert.match(panel, /<option key=\{voice\.id\} value=\{voice\.id\}>\{voice\.label\}<\/option>/);
});

test("an agency can upload its own custom tune to a dedicated Supabase bucket (not the shared document/avatar ones, which don't allow audio), serve it back for preview, and remove it — schema, storage plumbing, routes, and the frontend uploader", async () => {
  const [schema, migration, storage] = await Promise.all([
    source("../prisma/schema.prisma"),
    source("../prisma/migrations/20260902120000_add_agency_custom_tune/migration.sql"),
    source("../src/services/supabaseStorage.js"),
  ]);
  assert.match(schema, /customTuneStorageKey\s+String\?\s+@map\("custom_tune_storage_key"\)/);
  assert.match(schema, /customTuneMimeType\s+String\?\s+@map\("custom_tune_mime_type"\)/);
  assert.match(schema, /customTuneFilename\s+String\?\s+@map\("custom_tune_filename"\)/);
  assert.match(schema, /customTuneUploadedAt\s+DateTime\?\s+@map\("custom_tune_uploaded_at"\)/);
  assert.match(migration, /ADD COLUMN "custom_tune_storage_key" TEXT/);
  assert.match(migration, /ADD COLUMN "custom_tune_uploaded_at" TIMESTAMP\(3\)/);
  assert.match(storage, /export const VOICE_TUNE_BUCKET = process\.env\.SUPABASE_VOICE_TUNE_BUCKET \|\| "agency-voice-tunes";/);
  // getBucket now tolerates a missing bucket (returns null) instead of
  // throwing, which is what lets ensureBucket provision it lazily on the
  // very first upload rather than requiring it to exist beforehand.
  assert.match(storage, /export async function getBucket\(bucket\) \{\s*\n\s*const response = await storageRequest\(`\/bucket\/\$\{encodeURIComponent\(bucket\)\}`, \{ allowMissing: true \}\);\s*\n\s*if \(!response\) return null;/);
  assert.match(storage, /export async function createBucket\(bucket, \{ public: isPublic = false, fileSizeLimit, allowedMimeTypes \} = \{\}\)/);
  assert.match(storage, /export async function ensureBucket\(bucket, options\) \{/);

  const middleware = await source("../src/middleware/audioTuneUploadMiddleware.js");
  assert.match(middleware, /"audio\/mpeg",/);
  assert.match(middleware, /limits: \{ fileSize: 10 \* 1024 \* 1024, files: 1 \}/);
  assert.match(middleware, /export const receiveAudioTune = upload\.single\("file"\);/);

  const controller = await source("../src/controllers/twilioSettingsController.js");
  // A dedicated bucket, not DOCUMENT_BUCKET/AVATAR_BUCKET — those already
  // have their own restrictive Supabase-side allowlists that don't include
  // audio, confirmed live: uploading audio/mpeg to case-files 400s.
  assert.match(controller, /import \{ VOICE_TUNE_BUCKET, downloadStorageFile, ensureBucket, removeStorageFile, uploadStorageFile \} from "\.\.\/services\/supabaseStorage\.js";/);
  assert.match(controller, /export async function uploadTwilioTune\(req, res\) \{/);
  assert.match(controller, /await ensureBucket\(VOICE_TUNE_BUCKET, \{ fileSizeLimit: 10 \* 1024 \* 1024, allowedMimeTypes: Object\.keys\(AUDIO_EXTENSIONS\) \}\);/);
  // Old file cleaned up only after the new one is safely referenced by the
  // DB row (and the freshly-uploaded object is cleaned up if the DB write
  // itself fails) — never left orphaned either way.
  assert.match(controller, /if \(existing\?\.customTuneStorageKey && existing\.customTuneStorageKey !== storageKey\) \{/);
  assert.match(controller, /export async function getTwilioTune\(req, res\) \{/);
  assert.match(controller, /export async function deleteTwilioTune\(req, res\) \{/);
  assert.match(controller, /hasCustomTune: Boolean\(settings\?\.customTuneStorageKey\),/);
  // Twilio always plays a <Play> to completion before re-checking a queued
  // caller's deadline, with no way to cut it short — an overly long tune
  // would silently delay the fallback to voicemail by its entire length, so
  // duration is probed (without ffmpeg — a pure-JS parser) and capped at
  // upload time rather than left to Twilio's playback behavior at call time.
  assert.match(controller, /import \{ parseBuffer \} from "music-metadata";/);
  assert.match(controller, /async function probeAudioDurationSeconds\(buffer, mimeType\) \{/);
  assert.match(controller, /const metadata = await parseBuffer\(buffer, \{ mimeType \}\);/);
  assert.match(controller, /const duration = await probeAudioDurationSeconds\(req\.file\.buffer, req\.file\.mimetype\);/);
  assert.match(controller, /if \(duration !== null && duration > MAX_CUSTOM_TUNE_SECONDS\) \{/);
  const constants = await source("../src/constants/twilioVoices.js");
  assert.match(constants, /export const MAX_CUSTOM_TUNE_SECONDS = 20;/);

  const routes = await source("../src/routes/settingsRoutes.js");
  assert.match(routes, /router\.post\("\/twilio\/tune", receiveAudioTune, asyncHandler\(uploadTwilioTune\)\);/);
  assert.match(routes, /router\.get\("\/twilio\/tune", asyncHandler\(getTwilioTune\)\);/);
  assert.match(routes, /router\.delete\("\/twilio\/tune", asyncHandler\(deleteTwilioTune\)\);/);

  const panel = await source("../../frontend/src/components/settings/AgencyTwilioSettingsPanel.jsx");
  // Superseded by the queue-hold-experience test below: once inboundWaitTwiML
  // actually shipped, the tune stopped being a stored-but-unused placeholder.
  assert.match(panel, /20 seconds or less\. It plays first; the "While waiting/);
  assert.match(panel, /to connect" message above joins in partway through, then both repeat on a loop while staff are being/);
  assert.match(panel, /const uploadTune = async \(event\) => \{/);
  assert.match(panel, /payload\.append\("file", tuneFile\);/);
  assert.match(panel, /const removeTune = async \(\) => \{/);
  assert.match(panel, /api\.get\("\/settings\/twilio\/tune", \{ responseType: "blob" \}\)/);
});

test("greeting text has a live browser preview, honestly labeled as approximate rather than the exact Polly voice a caller hears", async () => {
  const panel = await source("../../frontend/src/components/settings/AgencyTwilioSettingsPanel.jsx");
  assert.match(panel, /const previewGreeting = \(field, text\) => \{/);
  assert.match(panel, /if \(!text\?\.trim\(\) \|\| typeof window === "undefined" \|\| !window\.speechSynthesis\) return;/);
  assert.match(panel, /const utterance = new SpeechSynthesisUtterance\(text\.trim\(\)\);/);
  // Set expectations honestly — this is the browser's own voice, not proof
  // of what the Polly voice below will actually sound like on a real call.
  assert.match(panel, /won't sound exactly like the voice below, which is what callers actually hear\./);
  assert.match(panel, /onClick=\{\(\) => previewGreeting\("voice", voiceGreetingInput \|\| form\.voiceGreetingText\)\}/);
  assert.match(panel, /onClick=\{\(\) => previewGreeting\("voicemail", voicemailGreetingInput \|\| form\.voicemailGreetingText\)\}/);
  // Regression: the preview originally ignored the selected greeting voice
  // entirely, always speaking in the browser's own default — it now picks
  // a browser voice matching the selected Polly voice's gender (the Web
  // Speech API has no Polly-equivalent voices, so this is the closest
  // approximation available, not the exact voice).
  const constants = await source("../src/constants/twilioVoices.js");
  assert.match(constants, /\{ id: "Polly\.Joanna-Neural", label: "Joanna — warm \(female, US English\)", gender: "female" \},/);
  assert.match(constants, /\{ id: "Polly\.Matthew-Neural", label: "Matthew — confident \(male, US English\)", gender: "male" \},/);
  assert.match(panel, /function matchingBrowserVoice\(voices, gender\) \{/);
  assert.match(panel, /const \[browserVoices, setBrowserVoices\] = useState\(\[\]\);/);
  assert.match(panel, /window\.speechSynthesis\.addEventListener\("voiceschanged", loadVoices\);/);
  assert.match(panel, /const selectedVoice = \(form\.availableTtsVoices \|\| \[\]\)\.find\(\(voice\) => voice\.id === selectedVoiceId\);/);
  assert.match(panel, /const browserVoice = matchingBrowserVoice\(browserVoices, selectedVoice\?\.gender\);/);
  assert.match(panel, /if \(browserVoice\) utterance\.voice = browserVoice;/);
});

test("inbound calls ring staff via separate dispatched calls into a Twilio Queue (not a nested <Dial><Client>), so the caller can hear hold content while waiting — schema and the shared dispatch/cancel/wait machinery", async () => {
  const [schema, migration] = await Promise.all([
    source("../prisma/schema.prisma"),
    source("../prisma/migrations/20260902140000_add_queue_hold_experience/migration.sql"),
  ]);
  assert.match(schema, /whileWaitingGreetingText String\? @map\("while_waiting_greeting_text"\)/);
  assert.match(schema, /model CallRingDispatch \{/);
  assert.match(schema, /dispatchedCallSid String   @unique @map\("dispatched_call_sid"\)/);
  assert.match(schema, /@@map\("call_ring_dispatches"\)/);
  assert.match(migration, /ADD COLUMN "while_waiting_greeting_text" TEXT;/);
  assert.match(migration, /CREATE TABLE "call_ring_dispatches"/);
  assert.match(migration, /CONSTRAINT "call_ring_dispatches_dispatched_call_sid_key" UNIQUE \("dispatched_call_sid"\)/);

  const service = await source("../src/services/twilioCallService.js");
  // inboundTwiML no longer builds <Client> children of its own <Dial> — it
  // dispatches one outbound call per staff member and Enqueues the caller,
  // which is what makes waitUrl (custom hold content) possible at all; a
  // <Dial> has no equivalent.
  assert.doesNotMatch(service, /const clients = identities\.map/);
  assert.match(service, /if \(!identities\.length\) return `<Response>\$\{greetingTwiML\}\$\{voicemailTwiML\(config\.settings, statusBase\)\}<\/Response>`;/);
  assert.match(service, /const queueName = `call-\$\{parentCallSid\}`;/);
  // Fixes a real bug: a fast answer could find the queue still empty (the
  // caller's own Enqueue hadn't been processed by Twilio yet), so
  // <Dial><Queue> had nothing to bridge to and the consultant's screen
  // showed "Connecting…" right before the call just ended. Not awaiting
  // dispatchRingAttempts means this response — the one that actually
  // enqueues the caller — reaches Twilio without waiting on the ring
  // dispatch REST calls first.
  assert.doesNotMatch(service, /await dispatchRingAttempts\(/);
  assert.match(service, /dispatchRingAttempts\(\{ agencyId, config, identities, parentCallSid, callerNumber: inboundCallerNumber, base \}\)\.catch/);
  assert.match(service, /return `<Response>\$\{greetingTwiML\}<Enqueue waitUrl="\$\{escapeXml\(waitUrl\)\}" action="\$\{escapeXml\(statusBase\)\}">\$\{escapeXml\(queueName\)\}<\/Enqueue><\/Response>`;/);

  // Every ring attempt is its own real outbound call via the REST API
  // (client.calls.create), each recorded so it can be canceled once one
  // connects and so the answering browser can look itself up by CallSid.
  assert.match(service, /const RING_DISPATCH_DELAY_MS = 1_500;/);
  assert.match(service, /async function dispatchRingAttempts\(\{ agencyId, config, identities, parentCallSid, callerNumber, base \}\) \{/);
  assert.match(service, /await new Promise\(\(resolve\) => setTimeout\(resolve, RING_DISPATCH_DELAY_MS\)\);/);
  assert.match(service, /const call = await client\.calls\.create\(\{\s*\n\s*to: `client:\$\{identity\}`,\s*\n\s*from: config\.voiceNumber,\s*\n\s*url: dequeueUrl,/);
  assert.match(service, /await prisma\.callRingDispatch\.create\(\{\s*\n\s*data: \{ agencyId, parentCallSid, dispatchedCallSid: call\.sid, identity, callerNumber: callerNumber \|\| null \},/);

  assert.match(service, /export function dequeueTwiML\(queueName\) \{/);
  assert.match(service, /return `<Response><Dial><Queue>\$\{escapeXml\(queueName\)\}<\/Queue><\/Dial><\/Response>`;/);

  // Fixes a real bug: a consultant who answered was sometimes disconnected
  // immediately, because this leg's own ring-status callback and the
  // caller's QueueResult callback (which cancels still-ringing siblings)
  // are two independent, unordered webhooks — if QueueResult landed first,
  // the answering leg could still read "ringing" and get canceled along
  // with its actual siblings. Flipping it out of "ringing" here, before the
  // Dial/Queue TwiML is even returned, is safe regardless of webhook
  // ordering: Twilio cannot produce that QueueResult without first
  // receiving and executing this exact response.
  assert.match(service, /export async function markRingDispatchAnswered\(agencyId, dispatchedCallSid\) \{/);
  assert.match(service, /where: \{ agencyId, dispatchedCallSid, status: "ringing" \},\s*\n\s*data: \{ status: "answered" \},/);

  // The wait handler's deadline check only works because tune/greeting
  // playback is left at Twilio's default of playing once per fetch — a
  // <Play loop="0"> loops forever within a single response and Twilio
  // would never re-fetch waitUrl to notice the deadline had passed.
  assert.match(service, /export async function inboundWaitTwiML\(agencyId, query, req\) \{/);
  assert.match(service, /if \(Number\.isFinite\(deadline\) && Date\.now\(\) > deadline\) return "<Response><Leave\/><\/Response>";/);
  assert.match(service, /if \(settings\?\.customTuneStorageKey\) \{/);
  assert.doesNotMatch(service, /<Play loop="0">/);
  // The tune plays alone at first — being told "please hold" the instant
  // the caller is queued, on top of the greeting they just heard, reads as
  // an interruption rather than reassurance. Only once
  // WAIT_ANNOUNCEMENT_DELAY_MS has actually elapsed does the while-waiting
  // line join in (falling back to a sensible default rather than silence);
  // TwiML can't truly mix audio, so once it does, it's sequential: the line
  // is said, then the tune continues.
  assert.match(service, /const WAIT_ANNOUNCEMENT_DELAY_MS = 12_000;/);
  assert.match(service, /const elapsedMs = Number\.isFinite\(deadline\) \? QUEUE_WAIT_TIMEOUT_MS - \(deadline - Date\.now\(\)\) : Infinity;/);
  assert.match(service, /if \(elapsedMs < WAIT_ANNOUNCEMENT_DELAY_MS\) \{\s*\n\s*return `<Response><Play>\$\{escapeXml\(tuneUrl\)\}<\/Play><\/Response>`;/);
  assert.match(service, /const announcement = sayTwiML\(settings, settings\?\.whileWaitingGreetingText \|\| DEFAULT_WHILE_WAITING_GREETING_TEXT\);/);
  assert.match(service, /return `<Response>\$\{announcement\}<Play>\$\{escapeXml\(tuneUrl\)\}<\/Play><\/Response>`;/);
  const constants = await source("../src/constants/twilioVoices.js");
  assert.match(constants, /export const DEFAULT_WHILE_WAITING_GREETING_TEXT =/);

  // Answering doesn't by itself mean "connected" — only the caller's own
  // queue-result callback reporting QueueResult=bridged proves a real
  // bridge happened, which is what cancellation is gated on elsewhere.
  assert.match(service, /export async function recordRingDispatchStatus\(agencyId, body\) \{/);
  assert.match(service, /\? "answered"\s*\n\s*: \["completed", "busy", "no-answer", "canceled", "failed"\]\.includes\(status\)\s*\n\s*\? "no-answer"/);
  assert.match(service, /where: \{ agencyId, dispatchedCallSid, status: "ringing" \},/);

  assert.match(service, /export async function cancelSiblingRingDispatches\(agencyId, parentCallSid\) \{/);
  assert.match(service, /where: \{ agencyId, parentCallSid, status: "ringing" \},/);
  assert.match(service, /client\.calls\(row\.dispatchedCallSid\)\.update\(\{ status: "canceled" \}\)/);
});

test("the queue-result and per-dispatch webhooks are wired up: cancel whoever's still ringing the instant the caller leaves the queue, and only fall through to voicemail on a genuine timeout (never on a clean bridge or hangup)", async () => {
  const controller = await source("../src/controllers/twilioWebhookController.js");
  assert.match(controller, /import \{\s*\n\s*cancelSiblingRingDispatches,\s*\n\s*dequeueTwiML,\s*\n\s*handleTwilioCallStatus,\s*\n\s*inboundTwiML,\s*\n\s*inboundVoicemailTwiML,\s*\n\s*inboundWaitTwiML,\s*\n\s*markRingDispatchAnswered,\s*\n\s*outboundTwiML,\s*\n\s*recordRingDispatchStatus,/);
  assert.match(controller, /const isQueueResult = callback\.QueueResult !== undefined && Boolean\(callback\.callerNumber\);/);
  assert.match(controller, /await cancelSiblingRingDispatches\(req\.params\.agencyId, callback\.parentCallSid \|\| callback\.CallSid\)\.catch/);
  assert.match(controller, /if \(!\["bridged", "hangup"\]\.includes\(queueResult\)\) \{/);
  assert.match(controller, /export async function twilioDequeue\(req, res\) \{/);
  // Marking this leg answered here — strictly before the Dial/Queue TwiML is
  // even returned — closes a real race: this leg's own ring-status callback
  // and the caller's own QueueResult callback (which drives
  // cancelSiblingRingDispatches) are two independent, unordered webhooks. If
  // QueueResult were processed first, cancelSiblingRingDispatches would
  // still see this row as "ringing" and cancel the very call that just
  // connected the caller — hanging up on a consultant the instant they
  // answered. This write is guaranteed to land first because Twilio cannot
  // produce that QueueResult without first receiving and executing this
  // exact response.
  assert.match(controller, /await markRingDispatchAnswered\(req\.params\.agencyId, req\.body\?\.CallSid\)\.catch/);
  assert.match(controller, /export async function twilioWait\(req, res\) \{/);
  assert.match(controller, /export async function twilioRingStatus\(req, res\) \{/);
  // The tune Twilio's <Play> actually fetches has to be a plain,
  // unauthenticated GET — there's no user session for Twilio to carry, so
  // it can't sit behind the same auth as the settings-page preview.
  assert.match(controller, /export async function twilioServeTune\(req, res\) \{/);
  assert.match(controller, /const buffer = await downloadStorageFile\(VOICE_TUNE_BUCKET, settings\.customTuneStorageKey, \{ allowMissing: true \}\);/);

  const routes = await source("../src/routes/communicationWebhookRoutes.js");
  assert.match(routes, /router\.post\("\/twilio\/dequeue\/:agencyId", asyncHandler\(twilioDequeue\)\);/);
  assert.match(routes, /router\.post\("\/twilio\/wait\/:agencyId", asyncHandler\(twilioWait\)\);/);
  assert.match(routes, /router\.post\("\/twilio\/ring-status\/:agencyId", asyncHandler\(twilioRingStatus\)\);/);
  assert.match(routes, /router\.get\("\/twilio\/tune\/:agencyId", asyncHandler\(twilioServeTune\)\);/);
});

test("a staff browser can resolve who's calling for a queue-dispatched ring (which never carries TwiML <Parameter> values, unlike a nested <Dial><Client>) by looking its own call up by CallSid, and the answer button waits for that lookup rather than risking the wrong CallSid", async () => {
  const controller = await source("../src/controllers/twilioCallController.js");
  assert.match(controller, /export async function getIncomingCallContext\(req, res\) \{/);
  assert.match(controller, /where: \{ agencyId: req\.user\.agencyId, dispatchedCallSid: req\.params\.callSid \},/);

  const routes = await source("../src/routes/twilioCallRoutes.js");
  assert.match(routes, /router\.get\("\/incoming-context\/:callSid", asyncHandler\(getIncomingCallContext\)\);/);

  const provider = await source("../../frontend/src/components/calls/SoftphoneProvider.jsx");
  // Listeners attach before any lookup, so a cancel/hangup that arrives
  // mid-lookup still cleans up even though the ring UI never showed.
  assert.match(provider, /call\.on\("cancel", clearIncoming\);\s*\n\s*call\.on\("reject", clearIncoming\);/);
  assert.match(provider, /const showIncoming = \(from, callSid\) => \{/);
  assert.match(provider, /if \(incomingCallRef\.current !== call\) return;/);
  // customParameters are checked first (still correct for an internal-line
  // call or a legacy nested <Dial><Client>) and only fall back to the
  // backend lookup when they're genuinely empty.
  assert.match(provider, /if \(customFrom \|\| customParentSid\) \{/);
  assert.match(provider, /api\.get\(`\/twilio-calls\/incoming-context\/\$\{encodeURIComponent\(dispatchedCallSid\)\}`\)\.then/);
  assert.match(provider, /showIncoming\(context\?\.callerNumber \|\| call\.parameters\?\.From \|\| "", context\?\.parentCallSid \|\| dispatchedCallSid\);/);
});

test("the settings panel's third greeting (\"while waiting to connect\") has the same masking/save/preview treatment as the other two, and the custom tune's copy reflects that it's now actually used on calls, not just stored", async () => {
  const controller = await source("../src/controllers/twilioSettingsController.js");
  assert.match(controller, /whileWaitingGreetingText: settings\?\.whileWaitingGreetingText \|\| "",/);
  assert.match(controller, /const whileWaitingGreetingText = body\.whileWaitingGreetingText !== undefined \? clean\(body\.whileWaitingGreetingText, 300\) : existing\?\.whileWaitingGreetingText \|\| "";/);
  assert.match(controller, /whileWaitingGreetingText: whileWaitingGreetingText \|\| null,/);

  const panel = await source("../../frontend/src/components/settings/AgencyTwilioSettingsPanel.jsx");
  assert.match(panel, /const \[whileWaitingGreetingInput, setWhileWaitingGreetingInput\] = useState\(""\);/);
  assert.match(panel, /whileWaitingGreetingText: whileWaitingGreetingInput \|\| form\.whileWaitingGreetingText,/);
  assert.match(panel, /While waiting to connect/);
  assert.match(panel, /onClick=\{\(\) => previewGreeting\("waiting", whileWaitingGreetingInput \|\| form\.whileWaitingGreetingText\)\}/);
  assert.match(panel, /Repeats on a loop while staff are being rung\. If a custom tune is uploaded below, the tune plays/);
  assert.match(panel, /first — this joins in partway through, rather than interrupting it immediately\./);
  // No longer a placeholder — it's genuinely wired into the wait handler
  // now: the tune plays first, and the spoken line only joins in partway
  // through rather than interrupting it immediately (inboundWaitTwiML can't
  // truly mix the two, so once it does join in, it plays them in sequence).
  assert.match(panel, /20 seconds or less\. It plays first; the "While waiting/);
  assert.match(panel, /to connect" message above joins in partway through, then both repeat on a loop while staff are being/);
  assert.match(panel, /setTuneNotice\("Tune uploaded\. Callers will hear it while staff are being rung\."\);/);
});

test("call recordings (including voicemails) play with one click instead of linking out to Twilio's raw, credential-gated media URL", async () => {
  const controller = await source("../src/controllers/callHistoryController.js");
  // Twilio's recording media URL 401s without the account's own Basic Auth
  // credentials, so it can never be handed to the browser directly — this
  // proxies the bytes through the same access-checked requireCall path
  // every other call action uses, then streams them back with CaseDesk's
  // own auth already satisfied.
  assert.match(controller, /import \{ decryptSecret \} from "\.\.\/services\/secretEncryption\.js";/);
  assert.match(controller, /export async function streamCallRecording\(req, res\) \{/);
  assert.match(controller, /const call = await requireCall\(req, \{\}\);/);
  assert.match(controller, /if \(!call\.recordingUrl\) throw createHttpError\(404, "No recording is available for this call\.", "RECORDING_NOT_FOUND"\);/);
  assert.match(controller, /const settings = await prisma\.agencyTwilioSettings\.findUnique\(\{ where: \{ agencyId: req\.auth\.agencyId \}, select: \{ accountSid: true, authTokenEncrypted: true \} \}\);/);
  assert.match(controller, /const auth = Buffer\.from\(`\$\{settings\.accountSid\}:\$\{decryptSecret\(settings\.authTokenEncrypted\)\}`\)\.toString\("base64"\);/);
  assert.match(controller, /const response = await fetch\(call\.recordingUrl, \{ headers: \{ Authorization: `Basic \$\{auth\}` \} \}\);/);
  assert.match(controller, /if \(!response\.ok\) throw createHttpError\(502, "The recording could not be retrieved from Twilio\."\);/);

  const routes = await source("../src/routes/callHistoryRoutes.js");
  assert.match(routes, /router\.get\("\/:id\/recording", asyncHandler\(streamCallRecording\)\);/);

  const player = await source("../../frontend/src/components/calls/CallRecordingPlayer.jsx");
  // Fetched as a blob (not a plain <audio src>) specifically because the
  // proxy above sits behind the same Bearer-token auth as every other API
  // call, which a browser-issued media request can't carry on its own.
  assert.match(player, /const response = await api\.get\(`\/call-history\/\$\{callId\}\/recording`, \{ responseType: "blob" \}\);/);
  assert.match(player, /setAudioUrl\(URL\.createObjectURL\(response\.data\)\);/);
  assert.match(player, /useEffect\(\(\) => \(\) => \{ if \(audioUrl\) URL\.revokeObjectURL\(audioUrl\); \}, \[audioUrl\]\);/);
  // A lead/client can easily rack up several voicemails — only one may ever
  // play at once, tracked via a module-level ref rather than per-instance
  // state so a second player can reach in and pause the first.
  assert.match(player, /let activeAudioEl = null;/);
  assert.match(player, /if \(activeAudioEl && activeAudioEl !== el\) activeAudioEl\.pause\(\);/);
  assert.match(player, /activeAudioEl = el;/);
  // A genuine voicemail (nobody answered) is labeled distinctly from a
  // recording of an answered conversation, rather than both reading
  // identically as just "Recording".
  assert.match(player, /const idleLabel = isVoicemail \? "Play voicemail" : "Play recording";/);
  assert.match(player, /const buttonSize = compact \? "h-7 px-2\.5 text-\[10px\]" : "h-9 px-4 text-xs";/);

  const [historyPage, leadSheet] = await Promise.all([
    source("../../frontend/src/pages/CallHistoryPage.jsx"),
    source("../../frontend/src/modules/leads/components/LeadDetailSheet.jsx"),
  ]);
  assert.match(historyPage, /import CallRecordingPlayer from "\.\.\/components\/calls\/CallRecordingPlayer";/);
  assert.match(historyPage, /\{call\.recordingUrl \? <CallRecordingPlayer callId=\{call\.id\} isVoicemail=\{call\.status === "MISSED"\} \/> : null\}/);
  assert.doesNotMatch(historyPage, /<a href=\{call\.recordingUrl\}/);
  assert.match(leadSheet, /import CallRecordingPlayer from "\.\.\/\.\.\/\.\.\/components\/calls\/CallRecordingPlayer";/);
  assert.match(leadSheet, /<CallRecordingPlayer callId=\{call\.id\} isVoicemail=\{call\.status === "MISSED"\} compact \/>/);
  assert.doesNotMatch(leadSheet, /<a href=\{call\.recordingUrl\}/);
});
