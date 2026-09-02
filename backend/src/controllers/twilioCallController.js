import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { normalizeCommunicationPhone } from "../services/communicationAddressService.js";
import { applyCallOutcome } from "../services/callHistoryService.js";
import {
  TWILIO_CALL_PROVIDER,
  deleteTwilioVoiceLine,
  issueTwilioAccessToken,
  listAgencyTwilioVoiceLines,
  listTwilioAddressBook,
  listTwilioCallableStaff,
  listTwilioVoiceNumbers,
  provisionTwilioVoiceLine,
  resolveAgencyTwilioVoiceConfig,
  setPrimaryTwilioVoiceLine,
  startCallRecording,
  stopCallRecording,
  syncTwilioCallHistory,
  transferTwilioCall,
  twilioVoiceConnectionStatus,
  updateTwilioVoiceLine,
} from "../services/twilioCallService.js";

const clean = (value, max = 500) => String(value ?? "").trim().slice(0, max);
const number = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
};

function requireAdmin(req) {
  if (req.user.role !== "admin") throw createHttpError(403, "Only workspace administrators can manage the Twilio voice connection");
}

export async function getTwilioVoiceStatus(req, res) {
  const data = await twilioVoiceConnectionStatus(req.user.agencyId);
  res.json({ data });
}

export async function issueTwilioCallToken(req, res) {
  const data = await issueTwilioAccessToken(req.user.agencyId, req.user.id);
  res.json({ data });
}

export async function listTwilioCallNumbers(req, res) {
  requireAdmin(req);
  const numbers = await listTwilioVoiceNumbers(req.user.agencyId);
  res.json({ data: numbers });
}

export async function listTwilioVoiceLines(req, res) {
  const data = await listAgencyTwilioVoiceLines(req.user.agencyId);
  res.json({ data });
}

export async function createTwilioVoiceLine(req, res) {
  requireAdmin(req);
  const numberSid = String(req.body?.numberSid || "").trim();
  const data = await provisionTwilioVoiceLine(
    req.user.agencyId,
    { numberSid, label: String(req.body?.label || ""), routing: String(req.body?.routing || "STAFF"), assignedUserIds: req.body?.assignedUserIds },
    req,
  );
  await recordActivity({
    agencyId: req.user.agencyId,
    userId: req.user.id,
    action: "settings.twilio_voice_line_added",
    details: `${data.line.label} line configured on ${data.line.phoneNumber} (${data.line.routing})`,
  });
  res.status(201).json({ data });
}

export async function patchTwilioVoiceLine(req, res) {
  requireAdmin(req);
  const data = await updateTwilioVoiceLine(req.user.agencyId, req.params.lineId, {
    label: req.body?.label,
    routing: req.body?.routing,
    enabled: req.body?.enabled,
    assignedUserIds: req.body?.assignedUserIds,
  });
  await recordActivity({
    agencyId: req.user.agencyId,
    userId: req.user.id,
    action: "settings.twilio_voice_line_updated",
    details: `${data.label} line (${data.phoneNumber}) updated`,
  });
  res.json({ data });
}

export async function makeTwilioVoiceLinePrimary(req, res) {
  requireAdmin(req);
  const data = await setPrimaryTwilioVoiceLine(req.user.agencyId, req.params.lineId);
  await recordActivity({
    agencyId: req.user.agencyId,
    userId: req.user.id,
    action: "settings.twilio_voice_line_primary",
    details: `${data.label} line (${data.phoneNumber}) set as the default calling number`,
  });
  res.json({ data });
}

export async function removeTwilioVoiceLine(req, res) {
  requireAdmin(req);
  const data = await deleteTwilioVoiceLine(req.user.agencyId, req.params.lineId);
  await recordActivity({
    agencyId: req.user.agencyId,
    userId: req.user.id,
    action: "settings.twilio_voice_line_removed",
    details: "Voice line removed",
  });
  res.json({ data });
}

export async function transferCall(req, res) {
  const data = await transferTwilioCall(req.user.agencyId, { toUserId: req.body?.to, callSid: req.body?.callSid }, req);
  await recordActivity({
    agencyId: req.user.agencyId,
    userId: req.user.id,
    action: "twilio.call_transferred",
    details: `Call transferred to ${data.target.fullName}`,
  });
  res.json({ data });
}

// Recording is opt-in per call, started/stopped from the in-call screen —
// see startCallRecording's own comment for why this isn't a Dial-verb
// default anymore.
export async function startRecording(req, res) {
  const data = await startCallRecording(req.user.agencyId, { callSid: req.body?.callSid }, req);
  await recordActivity({ agencyId: req.user.agencyId, userId: req.user.id, action: "twilio.call_recording_started", details: "Started recording an active call" });
  res.json({ data });
}

export async function stopRecording(req, res) {
  const data = await stopCallRecording(req.user.agencyId, { callSid: req.body?.callSid, recordingSid: req.body?.recordingSid });
  await recordActivity({ agencyId: req.user.agencyId, userId: req.user.id, action: "twilio.call_recording_stopped", details: "Stopped recording an active call" });
  res.json({ data });
}

export async function listTwilioCallStaff(req, res) {
  const data = await listTwilioCallableStaff(req.user.agencyId);
  res.json({ data });
}

export async function testTwilioCallVoice(req, res) {
  requireAdmin(req);
  const testedAt = new Date();
  try {
    // Token generation exercises the API Key (signing) end-to-end and the
    // number check confirms a Voice-capable number is on the account — no
    // minutes spent.
    const config = await resolveAgencyTwilioVoiceConfig(req.user.agencyId);
    await issueTwilioAccessToken(req.user.agencyId, req.user.id);
    const data = await prisma.agencyTwilioSettings.update({
      where: { agencyId: req.user.agencyId },
      data: { lastCallTestedAt: testedAt, lastCallTestStatus: "Connected", lastCallTestMessage: `Voice ready — calling from ${config.voiceNumber}.` },
    });
    await recordActivity({
      agencyId: req.user.agencyId,
      userId: req.user.id,
      action: "settings.twilio_voice_tested",
      details: `Twilio Voice connection verified (${config.voiceNumber})`,
    });
    res.json({ data: { lastCallTestedAt: data.lastCallTestedAt, lastCallTestStatus: data.lastCallTestStatus, lastCallTestMessage: data.lastCallTestMessage } });
  } catch (error) {
    const message = error.statusCode ? error.message : "Twilio Voice could not be verified. Confirm the API Key and number in the Twilio Console.";
    const data = await prisma.agencyTwilioSettings.update({
      where: { agencyId: req.user.agencyId },
      data: { lastCallTestedAt: testedAt, lastCallTestStatus: "Failed", lastCallTestMessage: message },
    });
    await recordActivity({
      agencyId: req.user.agencyId,
      userId: req.user.id,
      action: "settings.twilio_voice_test_failed",
      details: message,
    });
    res.status(error.statusCode || 502).json({ status: "error", message, data: { lastCallTestedAt: data.lastCallTestedAt, lastCallTestStatus: data.lastCallTestStatus, lastCallTestMessage: data.lastCallTestMessage } });
  }
}

export async function syncTwilioCallHistoryHandler(req, res) {
  requireAdmin(req);
  const data = await syncTwilioCallHistory(req.user.agencyId, { limit: Number(req.query.limit) || 100 });
  res.json({ data });
}

export async function listTwilioCallAddressBook(req, res) {
  const data = await listTwilioAddressBook(req.user.agencyId, { search: String(req.query.search || "") });
  res.json({ data });
}

// Keeps in-call notes usable even when the remote number is not yet linked to
// a CRM Lead/Client. The status callback normally creates this shared call
// session first; upsert also covers the brief race where someone starts a note
// before that callback arrives.
export async function saveActiveTwilioCallNote(req, res) {
  const agencyId = req.user.agencyId;
  const callSid = clean(req.body?.callSid, 64);
  const notes = clean(req.body?.notes, 3000);
  if (!callSid) throw createHttpError(400, "The call is still connecting. Keep typing and try again in a moment.", "CALL_SID_REQUIRED");
  if (!notes) throw createHttpError(400, "Enter a note before saving.", "CALL_NOTE_REQUIRED");
  const direction = clean(req.body?.direction, 20).toUpperCase() === "INBOUND" ? "INBOUND" : "OUTBOUND";
  const remoteNumber = clean(req.body?.remoteNumber, 80) || null;
  const now = new Date();
  const call = await prisma.callSession.upsert({
    where: { agencyId_providerCallId: { agencyId, providerCallId: callSid } },
    update: { outcomeNotes: notes, handledByUserId: req.user.id },
    create: {
      agencyId,
      provider: TWILIO_CALL_PROVIDER,
      providerCallId: callSid,
      direction,
      status: "ANSWERED",
      remoteNumber,
      remoteNumberNormalized: normalizeCommunicationPhone(remoteNumber),
      handledByUserId: req.user.id,
      outcomeNotes: notes,
      startedAt: now,
      answeredAt: now,
      lastEventAt: now,
      rawPayload: { callSid, createdByInCallNote: true },
    },
    select: { id: true, outcomeNotes: true, leadId: true, clientId: true },
  });
  res.json({ data: call });
}

// Called by the browser softphone's "call ended" popup. The Twilio status
// callback normally creates/updates the shared call-history session, but the
// popup can land before (or even without) it, so we find the session by the
// SDK's CallSid — falling back to creating a minimal one — and then route
// the disposition + notes + optional follow-up through the same applyCallOutcome
// path the Calls page drawer uses. The real status callback later completes
// the session's status/duration/recording without disturbing this outcome.
export async function recordOutboundCallOutcome(req, res) {
  const providerCallId = clean(req.body?.providerCallId, 64);
  if (!providerCallId) throw createHttpError(400, "The call could not be identified. Try again.", "CALL_SID_REQUIRED");
  const agencyId = req.user.agencyId;
  const leadId = clean(req.body?.leadId, 100) || null;
  const clientId = clean(req.body?.clientId, 100) || null;

  if (leadId) {
    const lead = await prisma.lead.findFirst({ where: { id: leadId, agencyId, deletedAt: null }, select: { id: true } });
    if (!lead) throw createHttpError(404, "Lead not found.", "LEAD_NOT_FOUND");
  }
  if (clientId) {
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } });
    if (!client) throw createHttpError(404, "Client not found.", "CLIENT_NOT_FOUND");
  }

  let call = await prisma.callSession.findFirst({
    where: {
      agencyId,
      OR: [{ providerCallId }, { rawPayload: { path: ["callSid"], equals: providerCallId } }, { rawPayload: { path: ["parentCallSid"], equals: providerCallId } }],
    },
    orderBy: { lastEventAt: "desc" },
    select: { id: true, leadId: true, clientId: true, outcomeNotes: true },
  });

  if (!call) {
    const remoteNumber = clean(req.body?.remoteNumber, 80) || null;
    const durationSeconds = number(req.body?.durationSeconds);
    const now = new Date();
    call = await prisma.callSession.create({
      data: {
        agencyId,
        provider: TWILIO_CALL_PROVIDER,
        providerCallId,
        direction: "OUTBOUND",
        status: "COMPLETED",
        remoteNumber,
        remoteNumberNormalized: normalizeCommunicationPhone(remoteNumber),
        handledByUserId: req.user.id,
        ...(leadId ? { leadId, resolution: "LINKED_LEAD", resolvedAt: now, resolvedById: req.user.id } : {}),
        ...(clientId ? { clientId, resolution: "LINKED_CLIENT", resolvedAt: now, resolvedById: req.user.id } : {}),
        startedAt: now,
        ...(durationSeconds != null ? { durationSeconds } : {}),
        lastEventAt: now,
        rawPayload: { callSid: providerCallId, createdByOutcomePopup: true },
      },
      select: { id: true, leadId: true, clientId: true, outcomeNotes: true },
    });
  } else {
    const data = {};
    if (leadId && !call.leadId) Object.assign(data, { leadId, resolution: "LINKED_LEAD", resolvedAt: new Date(), resolvedById: req.user.id });
    if (clientId && !call.clientId) Object.assign(data, { clientId, resolution: "LINKED_CLIENT", resolvedAt: new Date(), resolvedById: req.user.id });
    const durationSeconds = number(req.body?.durationSeconds);
    if (durationSeconds != null) data.durationSeconds = durationSeconds;
    if (Object.keys(data).length) call = await prisma.callSession.update({ where: { id: call.id }, data, select: { id: true, leadId: true, clientId: true, outcomeNotes: true } });
  }

  // Keep a note written during the live call when the post-call outcome card
  // is saved without an additional note. Explicit post-call text still wins.
  const outcomeInput = { ...req.body, notes: clean(req.body?.notes, 3000) || call.outcomeNotes || "" };
  await applyCallOutcome(call, outcomeInput, { agencyId, userId: req.user.id });
  res.json({ data: call });
}

// A call dispatched to ring a staff member's browser now arrives via a
// separate outbound call (see twilioCallService.js's dispatchRingAttempts),
// not nested inside the caller's own <Dial> — so the caller number/parent
// call id it needs to display can't ride along as TwiML <Parameter>
// values the way an internal-line or legacy <Dial><Client> call's still
// can. SoftphoneProvider.jsx checks customParameters first (still correct
// for those) and only falls back to this lookup, by the call's own SID,
// when they're empty.
export async function getIncomingCallContext(req, res) {
  const dispatch = await prisma.callRingDispatch.findFirst({
    where: { agencyId: req.user.agencyId, dispatchedCallSid: req.params.callSid },
    select: { parentCallSid: true, callerNumber: true },
  });
  res.json({ data: dispatch || null });
}
