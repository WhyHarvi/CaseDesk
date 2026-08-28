import twilio from "twilio";
import prisma from "./prisma/client.js";
import { logger } from "./logger.js";
import { decryptSecret } from "./secretEncryption.js";
import { createHttpError } from "../utils/http.js";
import { normalizeCommunicationPhone } from "./communicationAddressService.js";
import { autoMatch, phoneMatches } from "./callHistoryService.js";
import { adminRecipientIds, notifyUsers } from "./notificationService.js";
import { autoMarkPhoneAppointmentFromCall } from "./appointmentAttendanceService.js";

const clean = (value, max = 500) => String(value ?? "").trim().slice(0, max);
const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
};

export const TWILIO_CALL_PROVIDER = "TWILIO";

// Public base URL for TwiML/webhook URLs Twilio must be able to reach.
// Prefers the configured public API origin, falling back to the incoming
// request's own scheme/host (correct behind the reverse proxy that sets
// TRUST_PROXY_HOPS).
export function twilioPublicBase(req) {
  const configured = clean(process.env.API_PUBLIC_URL, 500);
  if (configured) return configured.replace(/\/+$/, "");
  const host = req?.get?.("host");
  if (host) {
    const proto = req.get("x-forwarded-proto")?.split(",")[0]?.trim() || req.protocol || "https";
    return `${proto}://${host}`;
  }
  return "https://api.example.com";
}

function twilioClient(settings) {
  return twilio(settings.accountSid, decryptSecret(settings.authTokenEncrypted));
}

function clientIdentity(userId) {
  return `casedesk:${userId}`;
}

function identityFromClient(value) {
  // Twilio reports the calling client as `client:casedesk:<userId>` (the
  // `client:` prefix is added by Twilio; `casedesk:` is ours), so strip both
  // to recover the raw userId that goes into handledByUserId.
  return clean(value, 200).replace(/^client:/, "").replace(/^casedesk:/, "");
}

function escapeXml(value) {
  return clean(value, 300)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

// resolveAgencyTwilioVoiceConfig returns the decrypted config needed to place
// or receive calls, or throws (or returns null with optional:true) explaining
// what's missing — mirroring agencyTwilioService.js's resolveAgencyTwilioConfig.
export async function resolveAgencyTwilioVoiceConfig(agencyId, { optional = false, requireNumber = true } = {}) {
  const settings = agencyId ? await prisma.agencyTwilioSettings.findUnique({ where: { agencyId } }) : null;
  const fail = (message) => {
    if (optional) return null;
    throw createHttpError(409, message);
  };
  if (!settings?.accountSid || !settings?.authTokenEncrypted) return fail("Twilio is not connected. Add the Account SID and Auth Token in Settings.");
  if (!settings.callsEnabled) return fail("Twilio calling is turned off in Settings.");
  if (!settings.apiKeySid || !settings.apiKeySecretEncrypted) return fail("Add a Twilio API Key (SID + Secret) in Settings to enable calling.");
  const voiceNumber = settings.voiceNumber || settings.fromNumber;
  // Listing numbers and provisioning the first line are the way a number gets
  // configured, so they must not require one to already exist (requireNumber:
  // false). Placing/receiving calls still does.
  if (requireNumber && !voiceNumber) return fail("Add a Twilio phone number to call from in Settings.");
  return {
    source: "Agency",
    accountSid: settings.accountSid,
    authToken: decryptSecret(settings.authTokenEncrypted),
    apiKeySid: settings.apiKeySid,
    apiKeySecret: decryptSecret(settings.apiKeySecretEncrypted),
    voiceNumber,
    twimlAppSid: settings.twimlAppSid || null,
    settings,
  };
}

export async function twilioVoiceConnectionStatus(agencyId) {
  const settings = agencyId ? await prisma.agencyTwilioSettings.findUnique({ where: { agencyId } }) : null;
  if (!settings?.accountSid || !settings?.authTokenEncrypted) {
    return { configured: false, detail: "Connect Twilio in Settings", source: null };
  }
  const steps = [];
  if (!settings.callsEnabled) steps.push("Calling is turned off in Settings");
  if (!settings.apiKeySid || !settings.apiKeySecretEncrypted) steps.push("Add a Twilio API Key (SID + Secret)");
  if (!settings.voiceNumber && !settings.fromNumber) steps.push("Add a Twilio phone number");
  if (!settings.twimlAppSid) steps.push("Connect voice (creates the TwiML Application)");
  const ready = steps.length === 0;
  return {
    configured: ready,
    detail: ready ? `Ready — calling from ${settings.voiceNumber || settings.fromNumber}` : steps.join("; "),
    source: "Twilio",
  };
}

// ---- Access Tokens (browser softphone) -------------------------------------

export async function issueTwilioAccessToken(agencyId, userId) {
  const config = await resolveAgencyTwilioVoiceConfig(agencyId);
  const directLine = await prisma.agencyTwilioVoiceLine.findFirst({
    where: { agencyId, routing: "DIRECT", enabled: true, assignments: { some: { userId } } },
    select: { phoneNumber: true },
  });
  const AccessToken = twilio.jwt.AccessToken;
  const VoiceGrant = AccessToken.VoiceGrant;
  const identity = clientIdentity(userId);
  const token = new AccessToken(config.accountSid, config.apiKeySid, config.apiKeySecret, {
    identity,
    ttl: 3600,
  });
  const grant = new VoiceGrant({
    ...(config.twimlAppSid ? { outgoingApplicationSid: config.twimlAppSid } : {}),
    incomingAllow: true,
  });
  token.addGrant(grant);
  return {
    token: token.toJwt(),
    identity,
    accountSid: config.accountSid,
    voiceNumber: directLine?.phoneNumber || config.voiceNumber,
    outboundReady: Boolean(config.twimlAppSid),
    expiresIn: 3600,
  };
}

// ---- Voice lines & TwiML Application provisioning --------------------------

const LINE_ROUTINGS = new Set(["FRONTDESK", "STAFF", "INTERNAL", "DIRECT"]);
const staffRoleWhere = { in: ["admin", "consultant", "frontdesk"] };
const unavailableTwiML = `<Response><Say voice="alice" language="en-US">This business is not available right now. Goodbye.</Say></Response>`;

async function callableStaff(agencyId, { roles } = {}) {
  return prisma.user.findMany({
    where: {
      agencyId,
      status: "active",
      memberships: { some: { agencyId, isActive: true, ...(roles?.length ? { role: { in: roles } } : { role: staffRoleWhere }) } },
    },
    select: { id: true, fullName: true, role: true },
    orderBy: { fullName: "asc" },
  });
}

async function staffClientIdentities(agencyId, { roles } = {}) {
  const staff = await callableStaff(agencyId, { roles });
  return staff.map((user) => clientIdentity(user.id));
}

// Every phone number the Twilio account owns that isn't already configured as
// a line — so an admin can turn any free number into the frontdesk or office
// line without double-provisioning.
export async function listTwilioVoiceNumbers(agencyId) {
  const config = await resolveAgencyTwilioVoiceConfig(agencyId, { requireNumber: false });
  const client = twilioClient(config.settings);
  const [rows, lines] = await Promise.all([
    client.incomingPhoneNumbers.list({ limit: 50 }),
    prisma.agencyTwilioVoiceLine.findMany({ where: { agencyId }, select: { numberSid: true } }),
  ]);
  const used = new Set(lines.map((line) => line.numberSid));
  return rows
    .map((row) => ({ sid: row.sid, phoneNumber: row.phoneNumber, friendlyName: row.friendlyName, voiceEnabled: row.voiceEnabled, capabilities: row.capabilities }))
    .filter((row) => row.voiceEnabled !== false && !used.has(row.sid))
    .sort((a, b) => a.phoneNumber.localeCompare(b.phoneNumber));
}

export async function listAgencyTwilioVoiceLines(agencyId) {
  const lines = await prisma.agencyTwilioVoiceLine.findMany({
    where: { agencyId },
    include: { assignments: { include: { user: { select: { id: true, fullName: true, role: true, status: true } } }, orderBy: { createdAt: "asc" } } },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });
  return lines.map(({ assignments, ...line }) => ({
    ...line,
    assignedUserIds: assignments.map((assignment) => assignment.userId),
    assignedUsers: assignments.map((assignment) => assignment.user),
  }));
}

// Twilio's REST errors carry a specific, human-readable .message (e.g. "The
// requested resource ... was not found", "Authenticate") — surfacing that
// (rather than letting the raw SDK error bubble up as an uncaught
// exception) is what keeps a real provisioning failure from being masked
// as "An unexpected error occurred" by the global error handler.
function friendlyTwilioVoiceError(error, fallback) {
  if (error?.status === 401 || error?.code === 20003) return "Twilio rejected the Account SID or Auth Token. Verify credentials in Settings, then try again.";
  const detail = clean(error?.message, 300);
  return detail ? `Twilio rejected this request: ${detail}` : fallback;
}

// Configures a Twilio number as a voice line: creates/reuses the shared TwiML
// Application (outbound), points the number's Voice webhook at the line's own
// inbound endpoint, and records the routing rule. The first line becomes the
// primary callerId; the INTERNAL line is the office line transfers ring from.
async function requireCallableAssignees(agencyId, assignedUserIds, { lineId } = {}) {
  const userIds = [...new Set((Array.isArray(assignedUserIds) ? assignedUserIds : []).map((value) => clean(value, 100)).filter(Boolean))].slice(0, 50);
  if (!userIds.length) throw createHttpError(400, "Choose at least one team member for this shared line.");
  const users = await prisma.user.findMany({
    where: { id: { in: userIds }, agencyId, status: "active", memberships: { some: { agencyId, isActive: true, role: staffRoleWhere } } },
    select: { id: true, fullName: true },
  });
  if (users.length !== userIds.length) throw createHttpError(400, "Every assigned person must be an active staff member.");
  const existing = await prisma.agencyTwilioVoiceLineAssignee.findFirst({
    where: { userId: { in: userIds }, ...(lineId ? { lineId: { not: lineId } } : {}) },
    include: { user: { select: { fullName: true } }, line: { select: { phoneNumber: true } } },
  });
  if (existing) throw createHttpError(409, `${existing.user.fullName} is already assigned to ${existing.line.phoneNumber}. Remove that assignment first.`);
  return users;
}

export async function provisionTwilioVoiceLine(agencyId, { numberSid, label, routing, assignedUserIds }, req) {
  const config = await resolveAgencyTwilioVoiceConfig(agencyId, { requireNumber: false });
  const client = twilioClient(config.settings);
  const numberSidClean = clean(numberSid, 64);
  if (!numberSidClean) throw createHttpError(400, "Choose a Twilio number to configure.");
  const routingClean = LINE_ROUTINGS.has(clean(routing)) ? clean(routing) : "STAFF";
  const labelClean = clean(label, 40) || "Line";
  const assignees = routingClean === "DIRECT" ? await requireCallableAssignees(agencyId, assignedUserIds) : [];

  const existing = await prisma.agencyTwilioVoiceLine.findUnique({ where: { numberSid: numberSidClean } });
  if (existing) throw createHttpError(409, "That number is already configured as a voice line.");

  const base = twilioPublicBase(req);
  let appSid = config.twimlAppSid;
  if (!appSid) {
    try {
      const app = await client.applications.create({
        friendlyName: "CaseDesk Voice",
        voiceMethod: "POST",
        voiceUrl: `${base}/api/communications/webhooks/twilio/outbound/${agencyId}`,
      });
      appSid = app.sid;
    } catch (error) {
      throw createHttpError(502, friendlyTwilioVoiceError(error, "Twilio could not create the calling application for this number."));
    }
  } else {
    // Keep the app's Voice URL pointed at CaseDesk even if the public origin
    // changed since provisioning.
    await client.applications(appSid).update({ voiceMethod: "POST", voiceUrl: `${base}/api/communications/webhooks/twilio/outbound/${agencyId}` }).catch(() => {});
  }

  const line = await prisma.agencyTwilioVoiceLine.create({
    data: {
      agencyId,
      numberSid: numberSidClean,
      phoneNumber: "pending",
      label: labelClean,
      routing: routingClean,
      assignments: { create: assignees.map((user) => ({ userId: user.id })) },
    },
  });
  let updated;
  try {
    updated = await client.incomingPhoneNumbers(numberSidClean).update({
      voiceMethod: "POST",
      voiceUrl: `${base}/api/communications/webhooks/twilio/inbound/${agencyId}/${line.id}`,
      statusCallbackMethod: "POST",
      statusCallback: `${base}/api/communications/webhooks/twilio/status/${agencyId}`,
    });
  } catch (error) {
    // The line row exists only to be filled in below — undo it on failure so
    // numberSid's unique constraint doesn't permanently block retrying this
    // same number after a failed provisioning attempt.
    await prisma.agencyTwilioVoiceLine.delete({ where: { id: line.id } }).catch(() => {});
    throw createHttpError(502, friendlyTwilioVoiceError(error, "Twilio could not configure this number for calling."));
  }

  const total = await prisma.agencyTwilioVoiceLine.count({ where: { agencyId } });
  const isPrimary = total === 1;
  const saved = await prisma.agencyTwilioVoiceLine.update({
    where: { id: line.id },
    data: { phoneNumber: updated.phoneNumber, isPrimary },
  });

  await prisma.agencyTwilioSettings.update({
    where: { agencyId },
    data: {
      twimlAppSid: appSid,
      callsEnabled: true,
      ...(isPrimary ? { voiceNumber: updated.phoneNumber } : {}),
      lastCallTestStatus: "Connected",
      lastCallTestMessage: `Voice configured for ${updated.phoneNumber}.`,
    },
  });
  logger.info("twilio.voice_line_provisioned", { agencyId, numberSid: numberSidClean, phoneNumber: updated.phoneNumber, routing: routingClean });
  return {
    line: saved,
    twimlAppSid: appSid,
    inboundUrl: `${base}/api/communications/webhooks/twilio/inbound/${agencyId}/${line.id}`,
  };
}

export async function updateTwilioVoiceLine(agencyId, lineId, { label, routing, enabled, assignedUserIds } = {}) {
  const line = await prisma.agencyTwilioVoiceLine.findFirst({ where: { id: lineId, agencyId }, include: { assignments: { select: { userId: true } } } });
  if (!line) throw createHttpError(404, "Voice line not found.");
  const data = {};
  if (label !== undefined) data.label = clean(label, 40) || line.label;
  if (routing !== undefined) {
    const value = clean(routing);
    if (!LINE_ROUTINGS.has(value)) throw createHttpError(400, "Routing must be FRONTDESK, STAFF, INTERNAL, or DIRECT.");
    data.routing = value;
  }
  const nextRouting = data.routing || line.routing;
  if (nextRouting === "DIRECT") {
    const nextUserIds = assignedUserIds !== undefined ? assignedUserIds : line.assignments.map((assignment) => assignment.userId);
    const assignees = await requireCallableAssignees(agencyId, nextUserIds, { lineId: line.id });
    data.assignments = { deleteMany: {}, create: assignees.map((user) => ({ userId: user.id })) };
  } else if (assignedUserIds !== undefined || data.routing) {
    data.assignments = { deleteMany: {} };
  }
  if (enabled !== undefined) data.enabled = enabled === true;
  return prisma.agencyTwilioVoiceLine.update({ where: { id: line.id }, data });
}

export async function deleteTwilioVoiceLine(agencyId, lineId) {
  const line = await prisma.agencyTwilioVoiceLine.findFirst({ where: { id: lineId, agencyId } });
  if (!line) throw createHttpError(404, "Voice line not found.");
  await prisma.agencyTwilioVoiceLine.delete({ where: { id: line.id } });
  if (line.isPrimary) {
    const next = await prisma.agencyTwilioVoiceLine.findFirst({ where: { agencyId }, orderBy: { createdAt: "asc" } });
    if (next) {
      await prisma.agencyTwilioVoiceLine.update({ where: { id: next.id }, data: { isPrimary: true } });
      await prisma.agencyTwilioSettings.update({ where: { agencyId }, data: { voiceNumber: next.phoneNumber } });
    }
  }
  return { deleted: true };
}

// The default calling number: outboundTwiML falls back to it for any staff
// member not on their own DIRECT line, and it's what a fresh workspace's
// very first line becomes automatically. This is the explicit "make this the
// default" action for switching it later.
export async function setPrimaryTwilioVoiceLine(agencyId, lineId) {
  const line = await prisma.agencyTwilioVoiceLine.findFirst({ where: { id: lineId, agencyId } });
  if (!line) throw createHttpError(404, "Voice line not found.");
  if (!line.enabled) throw createHttpError(400, "Enable this line before making it the default calling number.");
  if (line.isPrimary) return line;
  await prisma.$transaction([
    prisma.agencyTwilioVoiceLine.updateMany({ where: { agencyId, isPrimary: true }, data: { isPrimary: false } }),
    prisma.agencyTwilioVoiceLine.update({ where: { id: line.id }, data: { isPrimary: true } }),
    prisma.agencyTwilioSettings.update({ where: { agencyId }, data: { voiceNumber: line.phoneNumber } }),
  ]);
  logger.info("twilio.voice_line_made_primary", { agencyId, lineId: line.id, phoneNumber: line.phoneNumber });
  return { ...line, isPrimary: true };
}

// ---- TwiML handlers --------------------------------------------------------

// Incoming call to a line → ring only the staff its routing rule targets.
// DIRECT rings its assigned member, FRONTDESK rings frontdesk-role staff, and
// STAFF/INTERNAL ring the whole team.
export async function inboundTwiML(agencyId, lineId, req) {
  const config = await resolveAgencyTwilioVoiceConfig(agencyId, { optional: true });
  if (!config) return unavailableTwiML;
  let roles = null;
  let assignedUserIds = null;
  if (lineId) {
    const line = await prisma.agencyTwilioVoiceLine.findFirst({ where: { id: lineId, agencyId, enabled: true }, include: { assignments: { select: { userId: true } } } });
    if (!line) return unavailableTwiML;
    if (line.routing === "FRONTDESK") roles = ["frontdesk"];
    if (line.routing === "DIRECT") {
      const configuredUserIds = line.assignments.map((assignment) => assignment.userId);
      const assignees = configuredUserIds.length ? await prisma.user.findMany({
        where: { id: { in: configuredUserIds }, agencyId, status: "active", memberships: { some: { agencyId, isActive: true, role: staffRoleWhere } } },
        select: { id: true },
      }) : [];
      if (!assignees.length) return unavailableTwiML;
      assignedUserIds = assignees.map((assignee) => assignee.id);
    }
  }
  // Twilio's statusCallback on <Dial> reports on the leg it creates (the
  // browser <Client> leg). We map that event back to the inbound parent SID,
  // rather than the client leg's own SID, because that parent is what
  // the legacy call-session table ends up keyed by (providerCallId = parentCallSid ||
  // callSid). The browser's own incoming Call object only ever knows its
  // own (child) leg's SID, so transfer/recording — which need to find that
  // session row — would look up the wrong id and 409 as "no longer active"
  // unless we hand the parent SID over explicitly as a custom parameter.
  const parentCallSid = clean(req.body?.CallSid, 64);
  const inboundCallerNumber = clean(req.body?.From, 80);
  const base = twilioPublicBase(req);
  // A <Dial><Client> callback describes the browser child leg, where From is
  // `client:casedesk:<userId>`. Twilio does not consistently include the
  // parent SID on that callback, so carry the original inbound context in the
  // callback URL. This lets every event update the parent call-history row and
  // retain the external caller number instead of displaying "Private number".
  const inboundBusinessNumber = clean(req.body?.To, 80);
  const statusBase = `${base}/api/communications/webhooks/twilio/status/${agencyId}?parentCallSid=${encodeURIComponent(parentCallSid)}&callerNumber=${encodeURIComponent(inboundCallerNumber)}&businessNumber=${encodeURIComponent(inboundBusinessNumber)}`;
  // statusCallback/statusCallbackEvent belong on the <Client> noun, not on
  // <Dial> itself — Twilio's TwiML schema only allows them there. Putting
  // them on <Dial> instead is what Twilio Debugger warning 12200 ("not
  // allowed to appear in element 'Dial'") was flagging on this exact
  // endpoint, and per handleTwilioCallStatus's own notes below, an
  // attribute Twilio's parser rejects also just never reliably fires.
  const identities = assignedUserIds
    ? assignedUserIds.map((userId) => clientIdentity(userId))
    : await staffClientIdentities(agencyId, { roles });
  const clients = identities.map((identity) => `<Client statusCallback="${escapeXml(statusBase)}" statusCallbackEvent="initiated ringing answered completed">${escapeXml(identity)}<Parameter name="ParentCallSid" value="${escapeXml(parentCallSid)}"/><Parameter name="CallerNumber" value="${escapeXml(inboundCallerNumber)}"/></Client>`).join("");
  if (!clients) return `<Response><Say voice="alice" language="en-US">No one is available to take your call right now. Goodbye.</Say></Response>`;
  return `<Response><Dial callerId="${escapeXml(config.voiceNumber)}" timeout="25">${clients}</Dial></Response>`;
}

// Outbound call from a softphone client (the TwiML Application's Voice URL).
// Twilio POSTs To (the dialed number) and From (the client identity); we
// bridge to the external number with the agency number as callerId. Dialing
// the internal office line rings the whole team instead of an outside number.
export async function outboundTwiML(agencyId, req) {
  // Configuration and internal-line routing are independent reads. Resolve
  // them together so the TwiML webhook can tell Twilio where to dial without
  // paying for two sequential database round trips on every call.
  const agentIdentity = identityFromClient(req.body?.From);
  const [config, internalLine, directLine] = await Promise.all([
    resolveAgencyTwilioVoiceConfig(agencyId, { optional: true }),
    prisma.agencyTwilioVoiceLine.findFirst({ where: { agencyId, routing: "INTERNAL", enabled: true } }),
    agentIdentity ? prisma.agencyTwilioVoiceLine.findFirst({ where: { agencyId, routing: "DIRECT", enabled: true, assignments: { some: { userId: agentIdentity } } } }) : null,
  ]);
  if (!config) return `<Response><Say voice="alice" language="en-US">Calling is not configured. Please contact your administrator.</Say></Response>`;
  const toRaw = clean(req.body?.To, 40);
  if (!toRaw) return `<Response><Say voice="alice" language="en-US">No destination number was provided.</Say></Response>`;
  const to = escapeXml(toRaw);

  if (internalLine && normalizeCommunicationPhone(toRaw) === normalizeCommunicationPhone(internalLine.phoneNumber)) {
    // Same ParentCallSid hand-off as inboundTwiML above — the staff being
    // rung here only ever see their own (child) leg's SID otherwise.
    const parentCallSid = clean(req.body?.CallSid, 64);
    const base = twilioPublicBase(req);
    const statusBase = `${base}/api/communications/webhooks/twilio/status/${agencyId}`;
    // See inboundTwiML — statusCallback/statusCallbackEvent must live on
    // <Client>, not <Dial>, or Twilio's parser rejects them (Debugger 12200).
    const clients = (await staffClientIdentities(agencyId)).map((identity) => `<Client statusCallback="${escapeXml(statusBase)}" statusCallbackEvent="initiated ringing answered completed">${escapeXml(identity)}<Parameter name="ParentCallSid" value="${escapeXml(parentCallSid)}"/></Client>`).join("");
    if (!clients) return unavailableTwiML;
    return `<Response><Dial callerId="${escapeXml(internalLine.phoneNumber)}" timeout="30" answerOnBridge="true">${clients}</Dial></Response>`;
  }

  // The softphone dials with the lead/client id as a custom parameter so the
  // status callbacks (which repeat this URL's query params in their POST
  // body) can link the session to the record even when the number alone is
  // ambiguous — that's what makes a lead call auto-record as lead activity.
  const dialLeadId = clean(req.body?.leadId, 100);
  const dialClientId = clean(req.body?.clientId, 100);
  const base = twilioPublicBase(req);
  const statusBase = `${base}/api/communications/webhooks/twilio/status/${agencyId}?agent=${encodeURIComponent(agentIdentity)}${dialLeadId ? `&leadId=${encodeURIComponent(dialLeadId)}` : ""}${dialClientId ? `&clientId=${encodeURIComponent(dialClientId)}` : ""}&dialedNumber=${encodeURIComponent(toRaw)}`;
  // statusBase's query string joins params with a raw "&" — correct for a
  // URL, but a bare "&" inside an XML attribute value starts what looks
  // like an unterminated entity reference, so this must be XML-escaped
  // (not just URL-encoded) here or Twilio's parser rejects the whole
  // document and the caller hears "an application error has occurred" —
  // exactly what was happening on every call that carried a leadId/clientId.
  //
  // statusCallback/statusCallbackEvent are only valid on the <Number> noun,
  // not on <Dial> itself — putting them on <Dial> (as this used to) is what
  // triggered schema warning 12200 ("not allowed to appear in element
  // 'Dial'") and, per handleTwilioCallStatus's notes below, meant they never
  // reliably fired at all for this flow: every outbound call's remoteNumber
  // only ever showed up via a manual history sync (sometimes hours later),
  // while inbound calls stayed live the whole time. `action` on <Dial> is
  // unaffected by that and always fires once the dial finishes, so it stays
  // the authoritative mechanism here — handleTwilioCallStatus recognizes the
  // DialCallStatus/DialCallSid shape action posts and treats it as the
  // authoritative outbound outcome. Wrapping the number in <Number> now
  // lets statusCallback/statusCallbackEvent also fire correctly as a second,
  // redundant confirmation, with no change to what action already did. The
  // real dialed number rides along as `dialedNumber` since the action
  // request's own To/From describe the leg executing the Dial (the agent's
  // Client→Application leg), not the number actually dialed.
  const outboundCallerId = directLine?.phoneNumber || config.voiceNumber;
  return `<Response><Dial callerId="${escapeXml(outboundCallerId)}" timeout="30" answerOnBridge="true" action="${escapeXml(statusBase)}" method="POST"><Number statusCallback="${escapeXml(statusBase)}" statusCallbackEvent="initiated ringing answered completed">${to}</Number></Dial></Response>`;
}

// ---- Call transfer ---------------------------------------------------------

// Blind transfer: re-points the call's executing leg at the target agent's
// softphone. The transferring agent's device hangs up; the caller stays on the
// line and hears ringback until the target answers. The internal line number
// (when configured) is what the target sees as the caller.
export async function transferTwilioCall(agencyId, { toUserId, callSid }, req) {
  const config = await resolveAgencyTwilioVoiceConfig(agencyId);
  const targetUserId = clean(toUserId, 100);
  if (!targetUserId) throw createHttpError(400, "Choose a team member to transfer to.");
  const target = await prisma.user.findFirst({
    where: { id: targetUserId, agencyId, status: "active", memberships: { some: { agencyId, isActive: true, role: staffRoleWhere } } },
    select: { id: true, fullName: true },
  });
  if (!target) throw createHttpError(404, "That team member is not available to take calls.");

  const session = await activeTwilioCall(agencyId, callSid, "transfer", config);

  const client = twilioClient(config.settings);
  const base = twilioPublicBase(req);
  const statusBase = `${base}/api/communications/webhooks/twilio/status/${agencyId}?agent=${encodeURIComponent(target.id)}`;
  const internalLine = await prisma.agencyTwilioVoiceLine.findFirst({ where: { agencyId, routing: "INTERNAL", enabled: true } });
  const callerId = internalLine?.phoneNumber || config.voiceNumber;
  // activeTwilioCall resolves the controllable live leg (normally the parent
  // SID). Hand that SID to the next browser so the transferred-to person can
  // transfer or record again without depending on callback timing.
  // statusCallback/statusCallbackEvent go on <Client>, not <Dial> — see
  // inboundTwiML for why (Debugger 12200).
  const twiml = `<Response><Dial callerId="${escapeXml(callerId)}" timeout="30"><Client statusCallback="${escapeXml(statusBase)}" statusCallbackEvent="initiated ringing answered completed">${escapeXml(clientIdentity(target.id))}<Parameter name="ParentCallSid" value="${escapeXml(session.providerCallId)}"/></Client></Dial></Response>`;
  await client.calls(session.providerCallId).update({ twiml });
  logger.info("twilio.call_transferred", { agencyId, providerCallId: session.providerCallId, fromAgent: session.handledByUserId, toAgent: target.id });
  return { transferred: true, callerId, target: { id: target.id, fullName: target.fullName } };
}

const LIVE_TWILIO_CALL_STATUSES = new Set(["queued", "ringing", "in-progress"]);

// Status callbacks are call-history input, not a reliable lock on live call
// controls. Twilio can deliver the browser's CallSid before the Dial-leg
// callback has created its session row, and callbacks from sibling legs can
// briefly make that row look completed while the parent call is still live.
// Prefer the fast local lookup, but verify candidates against Twilio whenever
// the history row is missing/stale so Record and Transfer follow the actual
// call rather than webhook timing.
async function activeTwilioCall(agencyId, callSid, actionLabel, config) {
  const callSidClean = clean(callSid, 64);
  if (!callSidClean) throw createHttpError(400, `No active call to ${actionLabel}.`);
  const session = await prisma.callSession.findFirst({
    where: {
      agencyId,
      provider: TWILIO_CALL_PROVIDER,
      lastEventAt: { gte: new Date(Date.now() - 30 * 60 * 1000) },
      OR: [
        { providerCallId: callSidClean },
        { rawPayload: { path: ["callSid"], equals: callSidClean } },
        { rawPayload: { path: ["parentCallSid"], equals: callSidClean } },
      ],
    },
    orderBy: { lastEventAt: "desc" },
  });
  if (session && ["RINGING", "ANSWERED"].includes(session.status)) return session;

  const client = twilioClient(config.settings);
  const candidates = [...new Set([session?.providerCallId, callSidClean].filter(Boolean))];
  for (const candidate of candidates) {
    try {
      const liveCall = await client.calls(candidate).fetch();
      if (LIVE_TWILIO_CALL_STATUSES.has(clean(liveCall.status).toLowerCase())) {
        return session ? { ...session, providerCallId: liveCall.sid || candidate } : { providerCallId: liveCall.sid || candidate, handledByUserId: null };
      }
    } catch (error) {
      // A SID from the browser may represent a short-lived child leg while
      // the session stores its parent. Try every candidate before deciding
      // the live call is gone; surface real credential/provider failures.
      if (error?.status !== 404 && error?.code !== 20404) {
        throw createHttpError(502, friendlyTwilioVoiceError(error, "Twilio could not verify the active call."));
      }
    }
  }

  const unavailableAction = actionLabel === "transfer" ? "transferred" : actionLabel === "record" ? "recorded" : "stopped";
  throw createHttpError(409, `This call is no longer active and cannot be ${unavailableAction}.`);
}

// Recording is off by default (see inbound/outboundTwiML above) — staff opt
// in per call from the in-call screen instead. Starting via this REST
// endpoint (rather than declaring record="..." on the Dial verb) only
// captures audio from this moment forward, which is the whole point: the
// caller decides, mid-call, whether this particular conversation should be
// recorded, not every call by default.
export async function startCallRecording(agencyId, { callSid }, req) {
  const config = await resolveAgencyTwilioVoiceConfig(agencyId);
  const session = await activeTwilioCall(agencyId, callSid, "record", config);
  const client = twilioClient(config.settings);
  const base = twilioPublicBase(req);
  const statusBase = `${base}/api/communications/webhooks/twilio/status/${agencyId}?recording=1`;
  try {
    const recording = await client.calls(session.providerCallId).recordings.create({
      recordingStatusCallback: statusBase,
      recordingStatusCallbackEvent: ["completed"],
    });
    logger.info("twilio.call_recording_started", { agencyId, providerCallId: session.providerCallId, recordingSid: recording.sid });
    return { recordingSid: recording.sid, status: recording.status };
  } catch (error) {
    throw createHttpError(502, friendlyTwilioVoiceError(error, "Twilio could not start recording this call."));
  }
}

export async function stopCallRecording(agencyId, { callSid, recordingSid }) {
  const config = await resolveAgencyTwilioVoiceConfig(agencyId);
  const session = await activeTwilioCall(agencyId, callSid, "stop recording on", config);
  const recordingSidClean = clean(recordingSid, 64);
  if (!recordingSidClean) throw createHttpError(400, "No active recording to stop.");
  const client = twilioClient(config.settings);
  try {
    const recording = await client.calls(session.providerCallId).recordings(recordingSidClean).update({ status: "stopped" });
    logger.info("twilio.call_recording_stopped", { agencyId, providerCallId: session.providerCallId, recordingSid: recordingSidClean });
    return { recordingSid: recording.sid, status: recording.status };
  } catch (error) {
    throw createHttpError(502, friendlyTwilioVoiceError(error, "Twilio could not stop the recording."));
  }
}

// Team members the softphone can ring — used by the transfer picker (and a
// future extensions list).
export async function listTwilioCallableStaff(agencyId) {
  return callableStaff(agencyId);
}

// ---- Status callbacks → shared call history ---------------------------------

function twilioCallStatus(status, dialStatus) {
  const value = clean(status).toLowerCase();
  const dial = clean(dialStatus).toLowerCase();
  if (["in-progress", "answered"].includes(value)) return "ANSWERED";
  // The Dial child leg reports `completed` even when the other side never
  // picked up — DialCallStatus carries the real outcome (no-answer/busy/etc.),
  // so a completed-with-no-answer leg is a missed call, not a completed one.
  if (["completed"].includes(value)) {
    if (["busy", "no-answer", "canceled", "cancelled"].includes(dial)) return "MISSED";
    if (["failed"].includes(dial)) return "FAILED";
    return "COMPLETED";
  }
  if (["busy", "no-answer", "canceled", "cancelled"].includes(value)) return "MISSED";
  if (["failed"].includes(value)) return "FAILED";
  if (["queued", "initiated", "ringing", "ringing-in-progress"].includes(value)) return "RINGING";
  return null;
}

function twilioDirection(direction) {
  return clean(direction).toLowerCase().startsWith("outbound") ? "OUTBOUND" : "INBOUND";
}

async function twilioSessionByCallIds(tx, agencyId, callSid, parentCallSid) {
  const ids = [callSid, parentCallSid].filter(Boolean);
  if (!ids.length) return null;
  return tx.callSession.findFirst({
    where: { agencyId, provider: TWILIO_CALL_PROVIDER, providerCallId: { in: ids } },
    orderBy: { lastEventAt: "desc" },
  });
}

async function notifyTwilioCall(session, isNew, becameMissed) {
  const shouldNotify = (isNew && session.direction === "INBOUND") || becameMissed;
  if (!shouldNotify || session.direction !== "INBOUND") return;
  if (!["RINGING", "ANSWERED", "COMPLETED", "MISSED", "FAILED"].includes(session.status)) return;
  const recipientIds = [session.handledByUserId].filter(Boolean);
  if (!recipientIds.length) {
    const triageUsers = await prisma.user.findMany({
      where: { agencyId: session.agencyId, status: "active", memberships: { some: { agencyId: session.agencyId, isActive: true, role: { in: ["admin", "frontdesk"] } } } },
      select: { id: true },
    });
    recipientIds.push(...triageUsers.map((user) => user.id));
  }
  if (!recipientIds.length) recipientIds.push(...(await adminRecipientIds(session.agencyId)));
  await notifyUsers({
    agencyId: session.agencyId,
    recipientIds,
    type: session.status === "MISSED" ? "twilio.call.missed" : "twilio.call.incoming",
    category: "communications",
    title: session.status === "MISSED" ? "Missed Twilio call" : "Incoming Twilio call",
    body: session.remoteNumber || "Private or unidentified number",
    severity: session.status === "MISSED" ? "warning" : "info",
    entityType: "twilio_call",
    entityId: session.id,
    actionUrl: `/calls?call=${encodeURIComponent(session.id)}`,
    dedupeKey: `twilio-call:${session.id}:${session.status === "MISSED" ? "missed" : "incoming"}`,
    // Every fresh session starts "UNRESOLVED" by default (see schema), so
    // gating on that too meant essentially every single incoming call —
    // dozens a day — got flagged action_required, burying notifications
    // that actually need attention. A ringing/answered/completed call
    // isn't itself something to act on; a missed one is.
    attentionLevel: session.status === "MISSED" ? "action_required" : "informational",
  });
}

async function reconcileTwilioSession(session) {
  if (session.leadId) {
    const { syncCallLeadActivity, ensureCallCallbackFollowUp } = await import("./callHistoryService.js");
    await syncCallLeadActivity(session.id).catch(() => {});
    await ensureCallCallbackFollowUp(session.id).catch(() => {});
  }
}

// Twilio POSTs here for every Dial leg (ringing → answered → completed) and
// for recordings. One (agencyId, providerCallId) chain maps to one session.
export async function handleTwilioCallStatus({ agencyId, body }) {
  const callSid = clean(body.CallSid, 64);
  // Lower-camel fields are callback context deliberately threaded through the
  // TwiML URL; Twilio's own webhook fields use upper camel case.
  const parentCallSid = clean(body.parentCallSid || body.ParentCallSid, 64);
  if (!callSid && !parentCallSid) return { handled: false, reason: "no_call_sid" };

  // <Dial>'s action attribute always fires once the dial finishes and stays
  // the authoritative source for the outbound Client-initiated flow (see
  // outboundTwiML — statusCallback there now also fires correctly, since
  // it's properly nested on <Number>, but action was already reliable and
  // remains the primary signal). An action request is identifiable by
  // DialCallStatus/DialCallSid, params that never appear on a regular
  // per-leg status callback, and it's treated as the authoritative outbound
  // outcome below rather than the parent leg's own (irrelevant) status.
  const isDialAction = body.DialCallStatus !== undefined;
  const status = isDialAction ? twilioCallStatus("completed", body.DialCallStatus) : twilioCallStatus(body.CallStatus, body.DialCallStatus);
  const isRecording = body.recording === "1" || Boolean(clean(body.RecordingSid, 64));
  const occurredAt = new Date();

  // Recording callbacks carry only the media — never create a session from one.
  if (!isDialAction && isRecording && !status) {
    const session = await twilioSessionByCallIds(prisma, agencyId, callSid, parentCallSid);
    if (session && !session.recordingUrl) {
      const recordingUrl = clean(body.RecordingUrl, 2000) || null;
      if (recordingUrl) await prisma.callSession.update({ where: { id: session.id }, data: { recordingUrl, lastEventAt: occurredAt } });
    }
    return { handled: true, reason: "recording" };
  }

  const direction = isDialAction ? "OUTBOUND" : twilioDirection(body.Direction);
  // An action request's own To/From describe the leg executing the Dial
  // (the agent's Client→Application leg), not the number actually dialed —
  // outboundTwiML threads that through explicitly as `dialedNumber` instead.
  const explicitInboundCaller = direction === "INBOUND" ? clean(body.callerNumber, 80) : "";
  const remoteRaw = isDialAction ? clean(body.dialedNumber, 80) : (direction === "OUTBOUND" ? body.To : (explicitInboundCaller || body.From));
  // A `client:casedesk:<userId>` value means the other end of this leg is
  // one of our own agents' softphones — a <Client> ring-everyone/transfer
  // target, or the browser's own Client-to-Application leg for an outbound
  // call — never a real phone number. It must never be stored/displayed as
  // the caller's number, and Twilio doesn't reliably stamp ParentCallSid on
  // these particular legs (confirmed against live call logs), so a
  // standalone one with no existing session to attach to is pure noise: the
  // real call is tracked separately by its own top-level status callback,
  // and creating a session here would only add a phantom duplicate row
  // whose "caller" is a raw internal identity string.
  const remoteIsInternalClient = clean(remoteRaw, 200).startsWith("client:");
  const remoteNumber = remoteIsInternalClient ? null : (clean(remoteRaw, 80).replace(/^client:/, "") || null);
  const remoteNumberNormalized = normalizeCommunicationPhone(remoteNumber);
  const businessNumber = isDialAction ? null : clean(direction === "OUTBOUND" ? body.From : (body.businessNumber || body.To), 80).replace(/^client:/, "") || null;
  const agentIdentity = identityFromClient(clean(body.agent, 200));
  const durationSeconds = number(isDialAction ? body.DialCallDuration : body.CallDuration);
  const recordingUrl = clean(body.RecordingUrl, 2000) || null;
  // Dial context threaded through the softphone → TwiML → status callback
  // chain (see outboundTwiML). Verified against the agency so a stray or
  // stale id can never link a call to another agency's record.
  const explicitLeadId = clean(body.leadId, 100) || null;
  const explicitClientId = clean(body.clientId, 100) || null;

  if (remoteIsInternalClient) {
    const existingForInternalLeg = await twilioSessionByCallIds(prisma, agencyId, callSid, parentCallSid);
    if (!existingForInternalLeg) return { handled: false, reason: "internal_client_leg_no_session" };
  }

  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      const [leadMatch, clientMatch] = await Promise.all([
        explicitLeadId ? tx.lead.findFirst({ where: { id: explicitLeadId, agencyId, deletedAt: null }, select: { id: true } }) : Promise.resolve(null),
        explicitClientId ? tx.client.findFirst({ where: { id: explicitClientId, agencyId }, select: { id: true } }) : Promise.resolve(null),
      ]);
      const linkLeadId = leadMatch?.id || null;
      const linkClientId = clientMatch?.id || null;
      const existing = await twilioSessionByCallIds(tx, agencyId, callSid, parentCallSid);
      let session;
      if (existing) {
        const previousStatus = existing.status;
        session = await tx.callSession.update({
          where: { id: existing.id },
          data: {
            ...(status ? { status } : {}),
            direction: direction || existing.direction,
            remoteNumber: remoteNumber || existing.remoteNumber,
            remoteNumberNormalized: remoteNumberNormalized || existing.remoteNumberNormalized,
            businessNumber: businessNumber || existing.businessNumber,
            ...(agentIdentity && !existing.handledByUserId ? { handledByUserId: agentIdentity } : {}),
            // An explicitly dialed record only fills an unlinked session —
            // never overrides a match the number already produced.
            ...(linkLeadId && !existing.leadId ? { leadId: linkLeadId, resolution: "LINKED_LEAD", resolvedAt: existing.resolvedAt || occurredAt, resolvedById: existing.resolvedById } : {}),
            ...(linkClientId && !existing.clientId ? { clientId: linkClientId, resolution: "LINKED_CLIENT", resolvedAt: existing.resolvedAt || occurredAt, resolvedById: existing.resolvedById } : {}),
            ...(durationSeconds != null ? { durationSeconds } : {}),
            ...(recordingUrl ? { recordingUrl } : {}),
            ...(status === "ANSWERED" ? { answeredAt: existing.answeredAt || occurredAt } : {}),
            ...(status === "COMPLETED" ? { endedAt: existing.endedAt || occurredAt } : {}),
            lastEventAt: occurredAt,
          },
        });
        await autoMatch(tx, session).catch(() => {});
        return { session, previousStatus };
      }

      const providerCallId = parentCallSid || callSid;
      session = await tx.callSession.create({
        data: {
          agencyId,
          provider: TWILIO_CALL_PROVIDER,
          providerCallId,
          direction,
          status: status || "RINGING",
          remoteNumber,
          remoteNumberNormalized,
          businessNumber,
          handledByUserId: agentIdentity || null,
          ...(linkLeadId ? { leadId: linkLeadId, resolution: "LINKED_LEAD", resolvedAt: occurredAt } : {}),
          ...(linkClientId ? { clientId: linkClientId, resolution: "LINKED_CLIENT", resolvedAt: occurredAt } : {}),
          startedAt: occurredAt,
          ...(status === "ANSWERED" ? { answeredAt: occurredAt } : {}),
          ...(status === "COMPLETED" ? { endedAt: occurredAt } : {}),
          durationSeconds,
          recordingUrl,
          lastEventAt: occurredAt,
          rawPayload: { callSid, parentCallSid, callStatus: body.CallStatus, direction: body.Direction },
        },
      });
      session = await autoMatch(tx, session);
      return { session, previousStatus: null };
    });
  } catch (error) {
    if (error?.code === "P2002") {
      const existing = await twilioSessionByCallIds(prisma, agencyId, callSid, parentCallSid);
      if (existing) return { handled: true, reason: "dedupe", data: existing };
      throw error;
    }
    throw error;
  }

  const becameMissed = ["MISSED", "FAILED"].includes(result.session.status) && !["MISSED", "FAILED"].includes(result.previousStatus);
  const isNew = result.previousStatus === null;
  if (isNew || becameMissed) {
    await notifyTwilioCall(result.session, isNew, becameMissed);
  }
  if (result.session.leadId || result.session.clientId) await reconcileTwilioSession(result.session);
  if (result.session.status === "COMPLETED") {
    await autoMarkPhoneAppointmentFromCall(result.session).catch((error) => {
      logger.warn("appointment.twilio_attendance_failed", { sessionId: result.session.id, reason: error.message });
    });
  }
  return { handled: true, data: result.session };
}

// ---- History sync from the Twilio API --------------------------------------

function apiCallStatus(call) {
  const value = clean(call.status).toLowerCase();
  if (value === "completed") return "COMPLETED";
  if (["busy", "no-answer", "canceled", "cancelled", "no-answer"].includes(value)) return "MISSED";
  if (value === "failed") return "FAILED";
  if (value === "in-progress") return "ANSWERED";
  if (value === "ringing" || value === "queued" || value === "initiated") return "RINGING";
  return "COMPLETED";
}

function recordingMediaUrl(recording) {
  if (!recording) return null;
  const base = clean(recording.mediaUrl || recording.uri || "", 2000);
  if (!base) return null;
  if (base.startsWith("http")) return base.endsWith(".mp3") ? base : `${base}.mp3`;
  return null;
}

// Backstop for calls that never hit a status callback (e.g. placed outside
// CaseDesk, or made while the app was down) — pulls the account's recent call
// log and upserts everything into the shared inbox.
export async function syncTwilioCallHistory(agencyId, { limit = 100 } = {}) {
  const config = await resolveAgencyTwilioVoiceConfig(agencyId, { optional: true });
  if (!config) return { synced: 0, total: 0, reason: "voice_not_configured" };
  const client = twilioClient(config.settings);
  const [calls, recordings] = await Promise.all([
    client.calls.list({ limit: Math.min(Math.max(limit, 1), 200) }),
    client.recordings.list({ limit: 400 }).catch(() => []),
  ]);
  const recordingByCall = new Map();
  for (const row of recordings) {
    const bucket = recordingByCall.get(row.callSid) || [];
    bucket.push(row);
    recordingByCall.set(row.callSid, bucket);
  }

  let synced = 0;
  for (const call of calls) {
    const direction = twilioDirection(call.direction);
    const remoteRaw = direction === "OUTBOUND" ? call.to : call.from;
    // Same internal-<Client>-leg noise as handleTwilioCallStatus above —
    // this backstop pulls every call resource from the account, including
    // bare <Client> ring/transfer legs, so it needs the identical guard to
    // avoid seeding a phantom session keyed to that leg's own SID.
    const remoteIsInternalClient = clean(remoteRaw, 200).startsWith("client:");
    const remoteNumber = remoteIsInternalClient ? null : (clean(remoteRaw, 80).replace(/^client:/, "") || null);
    const remoteNumberNormalized = normalizeCommunicationPhone(remoteNumber);
    const businessNumber = clean(direction === "OUTBOUND" ? call.from : call.to, 80).replace(/^client:/, "") || null;
    const recording = (recordingByCall.get(call.sid) || [])[0];
    const startedAt = call.startTime ? new Date(call.startTime) : new Date();
    const endedAt = call.endTime ? new Date(call.endTime) : null;
    const status = apiCallStatus(call);
    const data = {
      provider: TWILIO_CALL_PROVIDER,
      direction,
      status,
      remoteNumber,
      remoteNumberNormalized,
      businessNumber,
      startedAt,
      ...(status === "ANSWERED" ? { answeredAt: startedAt } : {}),
      ...(endedAt ? { endedAt } : {}),
      ...(call.duration ? { durationSeconds: number(call.duration) } : {}),
      recordingUrl: recordingMediaUrl(recording),
      lastEventAt: endedAt || startedAt,
      rawPayload: { callSid: call.sid, direction: call.direction, status: call.status },
    };
    try {
      const existing = await prisma.callSession.findUnique({ where: { agencyId_providerCallId: { agencyId, providerCallId: call.sid } } });
      if (remoteIsInternalClient && !existing) continue;
      await prisma.$transaction(async (tx) => {
        if (existing) {
          await tx.callSession.update({ where: { id: existing.id }, data: { ...data, startedAt: existing.startedAt } });
        } else {
          const created = await tx.callSession.create({ data: { agencyId, providerCallId: call.sid, ...data } });
          await autoMatch(tx, created).catch(() => {});
        }
      });
      synced += 1;
    } catch (error) {
      logger.warn("twilio.history_sync_failed", { agencyId, callSid: call.sid, reason: error.message });
    }
  }
  return { synced, total: calls.length };
}

// ---- Address book ----------------------------------------------------------

export async function listTwilioAddressBook(agencyId, { search = "" } = {}) {
  const needle = clean(search, 120);
  const digits = needle.replace(/\D/g, "");
  // Twilio supplies Canadian/US numbers as E.164 (+1...), while older CRM
  // records may contain only the local ten digits. Search both shapes so an
  // active call can resolve to its Lead/Client instead of leaving contextual
  // controls such as Notes unavailable.
  const phoneNeedles = [...new Set([digits, digits.length > 10 ? digits.slice(-10) : ""].filter(Boolean))];
  const matches = (fields) => [
    ...(needle
      ? fields.map((field) => ({ [field]: { contains: needle, mode: "insensitive" } }))
      : []),
    ...phoneNeedles.flatMap((phoneNeedle) => [
      { phone: { contains: phoneNeedle, mode: "insensitive" } },
      { phoneNormalized: { contains: phoneNeedle, mode: "insensitive" } },
    ]),
  ];
  const [clients, leads] = await Promise.all([
    prisma.client.findMany({
      where: { agencyId, ...(matches(["fullName", "clientNumber"]).length ? { OR: matches(["fullName", "clientNumber"]) } : {}) },
      select: { id: true, clientNumber: true, fullName: true, phone: true, phoneNormalized: true, status: true },
      orderBy: { fullName: "asc" },
      take: 200,
    }),
    prisma.lead.findMany({
      where: { agencyId, deletedAt: null, status: { in: ["OPEN", "NURTURE"] }, ...(matches(["firstName", "lastName", "leadNumber"]).length ? { OR: matches(["firstName", "lastName", "leadNumber"]) } : {}) },
      select: { id: true, leadNumber: true, firstName: true, lastName: true, phone: true, phoneNormalized: true, status: true, stage: true },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
  ]);
  return {
    clients,
    leads: leads.map((lead) => ({ ...lead, fullName: [lead.firstName, lead.lastName].filter(Boolean).join(" ") || lead.leadNumber })),
  };
}

export { phoneMatches };
