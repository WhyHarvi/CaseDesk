import twilio from "twilio";
import prisma from "./prisma/client.js";
import { logger } from "./logger.js";
import { decryptSecret } from "./secretEncryption.js";
import { createHttpError } from "../utils/http.js";
import { normalizeCommunicationPhone } from "./communicationAddressService.js";
import { autoMatch, phoneMatches } from "./oomaCallService.js";
import { adminRecipientIds, notifyUsers } from "./notificationService.js";

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
    voiceNumber: config.voiceNumber,
    outboundReady: Boolean(config.twimlAppSid),
    expiresIn: 3600,
  };
}

// ---- Voice lines & TwiML Application provisioning --------------------------

const LINE_ROUTINGS = new Set(["FRONTDESK", "STAFF", "INTERNAL"]);
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
  return prisma.agencyTwilioVoiceLine.findMany({
    where: { agencyId },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });
}

// Configures a Twilio number as a voice line: creates/reuses the shared TwiML
// Application (outbound), points the number's Voice webhook at the line's own
// inbound endpoint, and records the routing rule. The first line becomes the
// primary callerId; the INTERNAL line is the office line transfers ring from.
export async function provisionTwilioVoiceLine(agencyId, { numberSid, label, routing }, req) {
  const config = await resolveAgencyTwilioVoiceConfig(agencyId, { requireNumber: false });
  const client = twilioClient(config.settings);
  const numberSidClean = clean(numberSid, 64);
  if (!numberSidClean) throw createHttpError(400, "Choose a Twilio number to configure.");
  const routingClean = LINE_ROUTINGS.has(clean(routing)) ? clean(routing) : "STAFF";
  const labelClean = clean(label, 40) || "Line";

  const existing = await prisma.agencyTwilioVoiceLine.findUnique({ where: { numberSid: numberSidClean } });
  if (existing) throw createHttpError(409, "That number is already configured as a voice line.");

  const base = twilioPublicBase(req);
  let appSid = config.twimlAppSid;
  if (!appSid) {
    const app = await client.applications.create({
      friendlyName: "CaseDesk Voice",
      voiceMethod: "POST",
      voiceUrl: `${base}/api/communications/webhooks/twilio/outbound/${agencyId}`,
    });
    appSid = app.sid;
  } else {
    // Keep the app's Voice URL pointed at CaseDesk even if the public origin
    // changed since provisioning.
    await client.applications(appSid).update({ voiceMethod: "POST", voiceUrl: `${base}/api/communications/webhooks/twilio/outbound/${agencyId}` }).catch(() => {});
  }

  const line = await prisma.agencyTwilioVoiceLine.create({
    data: { agencyId, numberSid: numberSidClean, phoneNumber: "pending", label: labelClean, routing: routingClean },
  });
  const updated = await client.incomingPhoneNumbers(numberSidClean).update({
    voiceMethod: "POST",
    voiceUrl: `${base}/api/communications/webhooks/twilio/inbound/${agencyId}/${line.id}`,
    statusCallbackMethod: "POST",
    statusCallback: `${base}/api/communications/webhooks/twilio/status/${agencyId}`,
  });

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

export async function updateTwilioVoiceLine(agencyId, lineId, { label, routing, enabled } = {}) {
  const line = await prisma.agencyTwilioVoiceLine.findFirst({ where: { id: lineId, agencyId } });
  if (!line) throw createHttpError(404, "Voice line not found.");
  const data = {};
  if (label !== undefined) data.label = clean(label, 40) || line.label;
  if (routing !== undefined) {
    const value = clean(routing);
    if (!LINE_ROUTINGS.has(value)) throw createHttpError(400, "Routing must be FRONTDESK, STAFF, or INTERNAL.");
    data.routing = value;
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

// ---- TwiML handlers --------------------------------------------------------

// Incoming call to a line → ring only the staff its routing rule targets. A
// FRONTDESK line rings frontdesk-role staff exclusively; STAFF and INTERNAL
// lines ring the whole team (Twilio rings the registered clients sequentially).
export async function inboundTwiML(agencyId, lineId, req) {
  const config = await resolveAgencyTwilioVoiceConfig(agencyId, { optional: true });
  if (!config) return unavailableTwiML;
  let roles = null;
  if (lineId) {
    const line = await prisma.agencyTwilioVoiceLine.findFirst({ where: { id: lineId, agencyId, enabled: true } });
    if (!line) return unavailableTwiML;
    if (line.routing === "FRONTDESK") roles = ["frontdesk"];
  }
  const clients = (await staffClientIdentities(agencyId, { roles })).map((identity) => `<Client>${escapeXml(identity)}</Client>`).join("");
  if (!clients) return `<Response><Say voice="alice" language="en-US">No one is available to take your call right now. Goodbye.</Say></Response>`;
  const base = twilioPublicBase(req);
  const statusBase = `${base}/api/communications/webhooks/twilio/status/${agencyId}`;
  return `<Response><Dial callerId="${escapeXml(config.voiceNumber)}" timeout="25" record="record-from-answer" recordingStatusCallback="${statusBase}?recording=1" recordingStatusCallbackEvent="completed" statusCallback="${statusBase}" statusCallbackEvent="initiated ringing answered completed">${clients}</Dial></Response>`;
}

// Outbound call from a softphone client (the TwiML Application's Voice URL).
// Twilio POSTs To (the dialed number) and From (the client identity); we
// bridge to the external number with the agency number as callerId. Dialing
// the internal office line rings the whole team instead of an outside number.
export async function outboundTwiML(agencyId, req) {
  const config = await resolveAgencyTwilioVoiceConfig(agencyId, { optional: true });
  if (!config) return `<Response><Say voice="alice" language="en-US">Calling is not configured. Please contact your administrator.</Say></Response>`;
  const toRaw = clean(req.body?.To, 40);
  if (!toRaw) return `<Response><Say voice="alice" language="en-US">No destination number was provided.</Say></Response>`;
  const to = escapeXml(toRaw);

  const internalLine = await prisma.agencyTwilioVoiceLine.findFirst({ where: { agencyId, routing: "INTERNAL", enabled: true } });
  if (internalLine && normalizeCommunicationPhone(toRaw) === normalizeCommunicationPhone(internalLine.phoneNumber)) {
    const clients = (await staffClientIdentities(agencyId)).map((identity) => `<Client>${escapeXml(identity)}</Client>`).join("");
    if (!clients) return unavailableTwiML;
    const base = twilioPublicBase(req);
    const statusBase = `${base}/api/communications/webhooks/twilio/status/${agencyId}`;
    return `<Response><Dial callerId="${escapeXml(internalLine.phoneNumber)}" timeout="30" statusCallback="${statusBase}" statusCallbackEvent="initiated ringing answered completed">${clients}</Dial></Response>`;
  }

  const agentIdentity = identityFromClient(req.body?.From);
  // The softphone dials with the lead/client id as a custom parameter so the
  // status callbacks (which repeat this URL's query params in their POST
  // body) can link the session to the record even when the number alone is
  // ambiguous — that's what makes a lead call auto-record as lead activity.
  const dialLeadId = clean(req.body?.leadId, 100);
  const dialClientId = clean(req.body?.clientId, 100);
  const base = twilioPublicBase(req);
  const statusBase = `${base}/api/communications/webhooks/twilio/status/${agencyId}?agent=${encodeURIComponent(agentIdentity)}${dialLeadId ? `&leadId=${encodeURIComponent(dialLeadId)}` : ""}${dialClientId ? `&clientId=${encodeURIComponent(dialClientId)}` : ""}`;
  return `<Response><Dial callerId="${escapeXml(config.voiceNumber)}" timeout="30" record="record-from-answer" recordingStatusCallback="${statusBase}&amp;recording=1" recordingStatusCallbackEvent="completed" statusCallback="${statusBase}" statusCallbackEvent="initiated ringing answered completed">${to}</Dial></Response>`;
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

  const callSidClean = clean(callSid, 64);
  if (!callSidClean) throw createHttpError(400, "No active call to transfer.");
  const session = await prisma.oomaCallSession.findFirst({
    where: {
      agencyId,
      provider: TWILIO_CALL_PROVIDER,
      status: { in: ["RINGING", "ANSWERED"] },
      lastEventAt: { gte: new Date(Date.now() - 30 * 60 * 1000) },
      OR: [{ providerCallId: callSidClean }, { rawPayload: { path: ["callSid"], equals: callSidClean } }],
    },
    orderBy: { lastEventAt: "desc" },
  });
  if (!session) throw createHttpError(409, "This call is no longer active and cannot be transferred.");

  const client = twilioClient(config.settings);
  const base = twilioPublicBase(req);
  const statusBase = `${base}/api/communications/webhooks/twilio/status/${agencyId}?agent=${encodeURIComponent(target.id)}`;
  const internalLine = await prisma.agencyTwilioVoiceLine.findFirst({ where: { agencyId, routing: "INTERNAL", enabled: true } });
  const callerId = internalLine?.phoneNumber || config.voiceNumber;
  const twiml = `<Response><Dial callerId="${escapeXml(callerId)}" timeout="30" record="record-from-answer" recordingStatusCallback="${statusBase}&amp;recording=1" recordingStatusCallbackEvent="completed" statusCallback="${statusBase}" statusCallbackEvent="initiated ringing answered completed"><Client>${escapeXml(clientIdentity(target.id))}</Client></Dial></Response>`;
  await client.calls(session.providerCallId).update({ twiml });
  logger.info("twilio.call_transferred", { agencyId, providerCallId: session.providerCallId, fromAgent: session.handledByUserId, toAgent: target.id });
  return { transferred: true, callerId, target: { id: target.id, fullName: target.fullName } };
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
  return tx.oomaCallSession.findFirst({
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
    attentionLevel: session.resolution === "UNRESOLVED" || session.status === "MISSED" ? "action_required" : "informational",
  });
}

async function reconcileTwilioSession(session) {
  if (session.leadId) {
    const { syncOomaLeadActivity, ensureOomaCallbackFollowUp } = await import("./oomaCallService.js");
    await syncOomaLeadActivity(session.id).catch(() => {});
    await ensureOomaCallbackFollowUp(session.id).catch(() => {});
  }
}

// Twilio POSTs here for every Dial leg (ringing → answered → completed) and
// for recordings. One (agencyId, providerCallId) chain maps to one session.
export async function handleTwilioCallStatus({ agencyId, body }) {
  const callSid = clean(body.CallSid, 64);
  const parentCallSid = clean(body.ParentCallSid, 64);
  if (!callSid && !parentCallSid) return { handled: false, reason: "no_call_sid" };

  const status = twilioCallStatus(body.CallStatus, body.DialCallStatus);
  const isRecording = body.recording === "1" || Boolean(clean(body.RecordingSid, 64));
  const occurredAt = new Date();

  // Recording callbacks carry only the media — never create a session from one.
  if (isRecording && !status) {
    const session = await twilioSessionByCallIds(prisma, agencyId, callSid, parentCallSid);
    if (session && !session.recordingUrl) {
      const recordingUrl = clean(body.RecordingUrl, 2000) || null;
      if (recordingUrl) await prisma.oomaCallSession.update({ where: { id: session.id }, data: { recordingUrl, lastEventAt: occurredAt } });
    }
    return { handled: true, reason: "recording" };
  }

  const direction = twilioDirection(body.Direction);
  const remoteRaw = direction === "OUTBOUND" ? body.To : body.From;
  const remoteNumber = clean(remoteRaw, 80).replace(/^client:/, "") || null;
  const remoteNumberNormalized = normalizeCommunicationPhone(remoteNumber);
  const businessNumber = clean(direction === "OUTBOUND" ? body.From : body.To, 80).replace(/^client:/, "") || null;
  const agentIdentity = identityFromClient(clean(body.agent, 200));
  const durationSeconds = number(body.CallDuration);
  const recordingUrl = clean(body.RecordingUrl, 2000) || null;
  // Dial context threaded through the softphone → TwiML → status callback
  // chain (see outboundTwiML). Verified against the agency so a stray or
  // stale id can never link a call to another agency's record.
  const explicitLeadId = clean(body.leadId, 100) || null;
  const explicitClientId = clean(body.clientId, 100) || null;

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
        session = await tx.oomaCallSession.update({
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
      session = await tx.oomaCallSession.create({
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
    const remoteNumber = clean(remoteRaw, 80).replace(/^client:/, "") || null;
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
      await prisma.$transaction(async (tx) => {
        const existing = await tx.oomaCallSession.findUnique({ where: { agencyId_providerCallId: { agencyId, providerCallId: call.sid } } });
        if (existing) {
          await tx.oomaCallSession.update({ where: { id: existing.id }, data: { ...data, startedAt: existing.startedAt } });
        } else {
          const created = await tx.oomaCallSession.create({ data: { agencyId, providerCallId: call.sid, ...data } });
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
  const matches = (fields) => [
    ...(needle
      ? fields.map((field) => ({ [field]: { contains: needle, mode: "insensitive" } }))
      : []),
    ...(digits ? [{ phone: { contains: digits, mode: "insensitive" } }, { phoneNormalized: { contains: digits, mode: "insensitive" } }] : []),
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
