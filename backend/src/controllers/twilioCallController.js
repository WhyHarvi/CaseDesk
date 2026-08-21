import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import {
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
