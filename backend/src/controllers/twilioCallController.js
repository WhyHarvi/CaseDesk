import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { normalizeCommunicationPhone } from "../services/communicationAddressService.js";
import { applyCallOutcome } from "../services/oomaCallService.js";
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
    { numberSid, label: String(req.body?.label || ""), routing: String(req.body?.routing || "STAFF") },
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
  });
  await recordActivity({
    agencyId: req.user.agencyId,
    userId: req.user.id,
    action: "settings.twilio_voice_line_updated",
    details: `${data.label} line (${data.phoneNumber}) updated`,
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

  let call = await prisma.oomaCallSession.findFirst({
    where: {
      agencyId,
      OR: [{ providerCallId }, { rawPayload: { path: ["callSid"], equals: providerCallId } }, { rawPayload: { path: ["parentCallSid"], equals: providerCallId } }],
    },
    orderBy: { lastEventAt: "desc" },
    select: { id: true, leadId: true, clientId: true },
  });

  if (!call) {
    const remoteNumber = clean(req.body?.remoteNumber, 80) || null;
    const durationSeconds = number(req.body?.durationSeconds);
    const now = new Date();
    call = await prisma.oomaCallSession.create({
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
      select: { id: true, leadId: true, clientId: true },
    });
  } else {
    const data = {};
    if (leadId && !call.leadId) Object.assign(data, { leadId, resolution: "LINKED_LEAD", resolvedAt: new Date(), resolvedById: req.user.id });
    if (clientId && !call.clientId) Object.assign(data, { clientId, resolution: "LINKED_CLIENT", resolvedAt: new Date(), resolvedById: req.user.id });
    const durationSeconds = number(req.body?.durationSeconds);
    if (durationSeconds != null) data.durationSeconds = durationSeconds;
    if (Object.keys(data).length) call = await prisma.oomaCallSession.update({ where: { id: call.id }, data, select: { id: true, leadId: true, clientId: true } });
  }

  await applyCallOutcome(call, req.body, { agencyId, userId: req.user.id });
  res.json({ data: call });
}
