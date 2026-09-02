import path from "node:path";
import { randomUUID } from "node:crypto";
import { parseBuffer } from "music-metadata";
import prisma from "../services/prisma/client.js";
import { sendAgencyTwilioSms, verifyAgencyTwilioCredentials } from "../services/agencyTwilioService.js";
import { decryptSecret, encryptSecret, secretEncryptionReady } from "../services/secretEncryption.js";
import { createHttpError } from "../utils/http.js";
import { recordActivity } from "../utils/prismaCrud.js";
import { DEFAULT_TTS_VOICE, MAX_CUSTOM_TUNE_SECONDS, TTS_VOICES, TTS_VOICE_IDS } from "../constants/twilioVoices.js";
import { VOICE_TUNE_BUCKET, downloadStorageFile, ensureBucket, removeStorageFile, uploadStorageFile } from "../services/supabaseStorage.js";

const AUDIO_EXTENSIONS = {
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/wave": ".wav",
  "audio/ogg": ".ogg",
  "audio/aac": ".aac",
  "audio/mp4": ".m4a",
  "audio/x-m4a": ".m4a",
};

async function probeAudioDurationSeconds(buffer, mimeType) {
  try {
    const metadata = await parseBuffer(buffer, { mimeType });
    return Number.isFinite(metadata.format?.duration) ? metadata.format.duration : null;
  } catch {
    return null;
  }
}

const clean = (value, max = 300) => String(value ?? "").trim().slice(0, max);
const normalizePhone = (value) => {
  const source = clean(value, 40).replace(/[\s().-]/g, "");
  return source.startsWith("+") ? source : source ? `+${source}` : "";
};

function requireAdmin(req) {
  if (req.user.role !== "admin") throw createHttpError(403, "Only workspace administrators can manage the Twilio connection");
}

function publicSettings(settings, canManage) {
  return {
    configured: Boolean(settings?.accountSid && settings?.authTokenEncrypted),
    canManage,
    secureStorageReady: secretEncryptionReady(),
    accountSid: settings?.accountSid || "",
    fromNumber: settings?.fromNumber || "",
    messagingServiceSid: settings?.messagingServiceSid || "",
    hasAuthToken: Boolean(settings?.authTokenEncrypted),
    sendReady: Boolean(settings?.fromNumber || settings?.messagingServiceSid),
    enabled: settings?.enabled ?? true,
    smsEnabled: settings?.smsEnabled ?? true,
    // Voice (browser softphone)
    apiKeySid: settings?.apiKeySid || "",
    hasApiKeySecret: Boolean(settings?.apiKeySecretEncrypted),
    callsEnabled: settings?.callsEnabled ?? false,
    voiceNumber: settings?.voiceNumber || "",
    twimlAppSid: settings?.twimlAppSid || "",
    voiceReady: Boolean(settings?.callsEnabled && settings?.apiKeySid && settings?.apiKeySecretEncrypted && (settings?.voiceNumber || settings?.fromNumber) && settings?.twimlAppSid),
    lastCallTestedAt: settings?.lastCallTestedAt || null,
    lastCallTestStatus: settings?.lastCallTestStatus || null,
    lastCallTestMessage: settings?.lastCallTestMessage || null,
    lastVerifiedAt: settings?.lastVerifiedAt || null,
    lastVerifiedStatus: settings?.lastVerifiedStatus || null,
    lastVerifiedMessage: settings?.lastVerifiedMessage || null,
    lastSmsTestedAt: settings?.lastSmsTestedAt || null,
    lastSmsTestStatus: settings?.lastSmsTestStatus || null,
    lastSmsTestMessage: settings?.lastSmsTestMessage || null,
    // Call greetings
    voiceGreetingText: settings?.voiceGreetingText || "",
    voicemailGreetingText: settings?.voicemailGreetingText || "",
    whileWaitingGreetingText: settings?.whileWaitingGreetingText || "",
    ttsVoice: settings?.ttsVoice || DEFAULT_TTS_VOICE,
    availableTtsVoices: TTS_VOICES,
    // Custom tune — played while a caller waits in queue (see
    // twilioCallService.js's inboundWaitTwiML). hasCustomTune is what the
    // frontend gates the player/remove controls on; the storage key itself
    // never needs to leave the server.
    hasCustomTune: Boolean(settings?.customTuneStorageKey),
    customTuneFilename: settings?.customTuneFilename || "",
    customTuneUploadedAt: settings?.customTuneUploadedAt || null,
    updatedAt: settings?.updatedAt || null,
  };
}

// fromNumber/messagingServiceSid are deliberately optional here, unlike
// An agency can save real Twilio credentials today and add a number once they
// have one, without CaseDesk
// rejecting the save.
//
// The frontend saves this settings object from two separate forms — the
// account credentials card (accountSid/authToken/fromNumber/
// messagingServiceSid) and the voice card (apiKeySid/apiKeySecret/
// callsEnabled/voiceNumber) — and each PUT only sends its own fields, not
// the other card's. Every field here therefore falls back to the existing
// saved value when the request omits it (key not present in body), so
// saving one card can't blank out or reject on the other card's fields.
// A field is only cleared when the request explicitly sends an empty
// value for it (key present, value falsy) — that's still honored below.
function validate(body, existing) {
  const accountSid = body.accountSid !== undefined ? clean(body.accountSid, 64) : existing?.accountSid || "";
  if (!/^AC[a-f0-9]{32}$/i.test(accountSid)) throw createHttpError(400, "Enter a valid Twilio Account SID (starts with AC).");
  const fromNumber = body.fromNumber !== undefined ? normalizePhone(body.fromNumber) : existing?.fromNumber || "";
  if (fromNumber && !/^\+\d{8,15}$/.test(fromNumber)) throw createHttpError(400, "Enter the Twilio phone number including country code, such as +14165550100.");
  const messagingServiceSid = body.messagingServiceSid !== undefined ? clean(body.messagingServiceSid, 64) : existing?.messagingServiceSid || "";
  if (messagingServiceSid && !/^MG[a-f0-9]{32}$/i.test(messagingServiceSid)) throw createHttpError(400, "Enter a valid Twilio Messaging Service SID (starts with MG).");
  const apiKeySid = body.apiKeySid !== undefined ? clean(body.apiKeySid, 64) : existing?.apiKeySid || "";
  if (apiKeySid && !/^SK[a-f0-9]{32}$/i.test(apiKeySid)) throw createHttpError(400, "Enter a valid Twilio API Key SID (starts with SK).");
  const voiceNumber = body.voiceNumber !== undefined ? normalizePhone(body.voiceNumber) : existing?.voiceNumber || "";
  if (voiceNumber && !/^\+\d{8,15}$/.test(voiceNumber)) throw createHttpError(400, "Enter the Twilio voice number including country code, such as +14165550100.");
  // Capped to match twilioCallService.js's escapeXml, which truncates at the
  // same 300 chars before rendering into <Say> — a longer saved value would
  // otherwise silently get cut off mid-sentence when actually spoken.
  const voiceGreetingText = body.voiceGreetingText !== undefined ? clean(body.voiceGreetingText, 300) : existing?.voiceGreetingText || "";
  const voicemailGreetingText = body.voicemailGreetingText !== undefined ? clean(body.voicemailGreetingText, 300) : existing?.voicemailGreetingText || "";
  const whileWaitingGreetingText = body.whileWaitingGreetingText !== undefined ? clean(body.whileWaitingGreetingText, 300) : existing?.whileWaitingGreetingText || "";
  const ttsVoice = body.ttsVoice !== undefined ? clean(body.ttsVoice, 64) : existing?.ttsVoice || DEFAULT_TTS_VOICE;
  if (!TTS_VOICE_IDS.has(ttsVoice)) throw createHttpError(400, "Choose one of the available greeting voices.");
  return {
    accountSid,
    fromNumber: fromNumber || null,
    messagingServiceSid: messagingServiceSid || null,
    apiKeySid: apiKeySid || null,
    callsEnabled: body.callsEnabled !== undefined ? body.callsEnabled === true : Boolean(existing?.callsEnabled),
    voiceNumber: voiceNumber || null,
    enabled: body.enabled !== undefined ? body.enabled !== false : existing?.enabled ?? true,
    smsEnabled: body.smsEnabled !== undefined ? body.smsEnabled !== false : existing?.smsEnabled ?? true,
    voiceGreetingText: voiceGreetingText || null,
    voicemailGreetingText: voicemailGreetingText || null,
    whileWaitingGreetingText: whileWaitingGreetingText || null,
    ttsVoice,
  };
}

export async function getTwilioSettings(req, res) {
  const settings = await prisma.agencyTwilioSettings.findUnique({ where: { agencyId: req.user.agencyId } });
  res.json({ data: publicSettings(settings, req.user.role === "admin") });
}

export async function saveTwilioSettings(req, res) {
  requireAdmin(req);
  if (!secretEncryptionReady()) throw createHttpError(503, "Secure integration storage is not configured on this CaseDesk server");
  const existing = await prisma.agencyTwilioSettings.findUnique({ where: { agencyId: req.user.agencyId } });
  const values = validate(req.body, existing);
  const suppliedToken = clean(req.body.authToken, 300);
  if (!existing?.authTokenEncrypted && !suppliedToken) throw createHttpError(400, "Enter the Auth Token from the Twilio Console.");
  const authTokenEncrypted = suppliedToken ? encryptSecret(suppliedToken) : existing.authTokenEncrypted;
  const suppliedApiKeySecret = clean(req.body.apiKeySecret, 300);
  if (values.callsEnabled && !existing?.apiKeySecretEncrypted && !suppliedApiKeySecret) throw createHttpError(400, "Enter the Twilio API Key Secret to enable calling.");
  const apiKeySecretEncrypted = suppliedApiKeySecret ? encryptSecret(suppliedApiKeySecret) : existing.apiKeySecretEncrypted || null;
  const data = await prisma.agencyTwilioSettings.upsert({
    where: { agencyId: req.user.agencyId },
    create: {
      agencyId: req.user.agencyId,
      ...values,
      authTokenEncrypted,
      apiKeySecretEncrypted,
      lastVerifiedStatus: "Not verified",
      lastSmsTestStatus: values.smsEnabled ? "Not tested" : null,
    },
    update: {
      ...values,
      authTokenEncrypted,
      apiKeySecretEncrypted,
      lastVerifiedAt: null,
      lastVerifiedStatus: "Not verified",
      lastVerifiedMessage: "Credentials changed. Verify again.",
      lastSmsTestedAt: null,
      lastSmsTestStatus: values.smsEnabled ? "Not tested" : null,
      lastSmsTestMessage: values.smsEnabled ? "Settings changed. Send another test text." : null,
      lastCallTestedAt: null,
      lastCallTestStatus: values.callsEnabled ? "Not tested" : null,
      lastCallTestMessage: values.callsEnabled ? "Call settings changed. Verify voice again." : null,
    },
  });
  await recordActivity({
    agencyId: req.user.agencyId,
    userId: req.user.id,
    action: "settings.twilio_saved",
    details: `Twilio settings saved for account ${data.accountSid}`,
  });
  res.json({ data: publicSettings(data, true) });
}

// The credential-only smoke test — works today with just an Account SID and
// Auth Token, no phone number required.
export async function verifyTwilioCredentials(req, res) {
  requireAdmin(req);
  const settings = await prisma.agencyTwilioSettings.findUnique({ where: { agencyId: req.user.agencyId } });
  if (!settings?.accountSid || !settings?.authTokenEncrypted) throw createHttpError(409, "Save the Twilio Account SID and Auth Token before verifying");
  const verifiedAt = new Date();
  try {
    await verifyAgencyTwilioCredentials({ accountSid: settings.accountSid, authToken: decryptSecret(settings.authTokenEncrypted) });
    const data = await prisma.agencyTwilioSettings.update({
      where: { id: settings.id },
      data: { lastVerifiedAt: verifiedAt, lastVerifiedStatus: "Connected", lastVerifiedMessage: "Twilio confirmed these credentials are valid." },
    });
    await recordActivity({
      agencyId: req.user.agencyId,
      userId: req.user.id,
      action: "settings.twilio_verified",
      details: `Twilio credentials verified for account ${data.accountSid}`,
    });
    res.json({ data: publicSettings(data, true) });
  } catch (error) {
    const message = error.statusCode ? error.message : "Twilio could not be reached to verify these credentials.";
    const data = await prisma.agencyTwilioSettings.update({
      where: { id: settings.id },
      data: { lastVerifiedAt: verifiedAt, lastVerifiedStatus: "Failed", lastVerifiedMessage: message },
    });
    await recordActivity({
      agencyId: req.user.agencyId,
      userId: req.user.id,
      action: "settings.twilio_verify_failed",
      details: message,
    });
    res.status(error.statusCode || 502).json({ status: "error", message, data: publicSettings(data, true) });
  }
}

export async function testTwilioSms(req, res) {
  requireAdmin(req);
  const settings = await prisma.agencyTwilioSettings.findUnique({ where: { agencyId: req.user.agencyId } });
  if (!settings) throw createHttpError(409, "Save the Twilio details before sending a test text");
  const to = normalizePhone(req.body.to);
  if (!/^\+\d{8,15}$/.test(to)) throw createHttpError(400, "Enter the test phone number including country code");
  const testedAt = new Date();
  try {
    await sendAgencyTwilioSms({
      agencyId: req.user.agencyId,
      to,
      body: "CaseDesk connection test. Your Twilio SMS setup is working. Reply STOP to opt out.",
      requireVerified: false,
    });
    const data = await prisma.agencyTwilioSettings.update({
      where: { agencyId: req.user.agencyId },
      data: { lastSmsTestedAt: testedAt, lastSmsTestStatus: "Connected", lastSmsTestMessage: `Test message accepted for ${to}.` },
    });
    await recordActivity({
      agencyId: req.user.agencyId,
      userId: req.user.id,
      action: "settings.twilio_sms_tested",
      details: `Twilio SMS connection verified for ${data.fromNumber || data.messagingServiceSid}`,
    });
    res.json({ data: publicSettings(data, true) });
  } catch (error) {
    const message = error.statusCode ? error.message : "The Twilio test message failed. Confirm the account and number in the Twilio Console.";
    const data = await prisma.agencyTwilioSettings.update({
      where: { agencyId: req.user.agencyId },
      data: { lastSmsTestedAt: testedAt, lastSmsTestStatus: "Failed", lastSmsTestMessage: message },
    });
    await recordActivity({
      agencyId: req.user.agencyId,
      userId: req.user.id,
      action: "settings.twilio_sms_test_failed",
      details: message,
    });
    res.status(error.statusCode || 502).json({ status: "error", message, data: publicSettings(data, true) });
  }
}

// The agency's own uploaded tune — played as background hold music while a
// caller waits in queue (see twilioCallService.js's inboundWaitTwiML).
// Mirrors agencyProfileController.js's avatar upload/serve/delete pattern.
export async function uploadTwilioTune(req, res) {
  requireAdmin(req);
  if (!req.file) throw createHttpError(400, "Choose an audio file to upload.");
  const extension = AUDIO_EXTENSIONS[req.file.mimetype];
  if (!extension) throw createHttpError(400, "Unsupported file type. Upload an MP3, WAV, OGG, AAC, or M4A audio file.");
  // Twilio always plays a <Play> all the way through before re-checking
  // whether a queued caller's wait has timed out, with no way to cut it
  // short — so an overly long tune would silently delay the fallback to
  // voicemail by its entire length. A duration that can't be determined is
  // let through rather than rejected: a file odd enough to defeat parsing
  // here is just as likely to fail to play cleanly on Twilio's side too, so
  // blocking it gains little.
  const duration = await probeAudioDurationSeconds(req.file.buffer, req.file.mimetype);
  if (duration !== null && duration > MAX_CUSTOM_TUNE_SECONDS) {
    throw createHttpError(400, `Keep the tune under ${MAX_CUSTOM_TUNE_SECONDS} seconds — it loops while callers wait, and a longer track delays the fallback to voicemail when nobody answers.`);
  }
  const existing = await prisma.agencyTwilioSettings.findUnique({ where: { agencyId: req.user.agencyId } });
  const storageKey = path.posix.join(req.user.agencyId, "voice-tune", `${randomUUID()}${extension}`);
  // Dedicated bucket, not the shared document/avatar ones — those already
  // have their own restrictive Supabase-side mime-type allowlists that
  // don't include audio, and broadening either would loosen what they
  // accept for everything else that uses them too.
  await ensureBucket(VOICE_TUNE_BUCKET, { fileSizeLimit: 10 * 1024 * 1024, allowedMimeTypes: Object.keys(AUDIO_EXTENSIONS) });
  await uploadStorageFile(VOICE_TUNE_BUCKET, storageKey, req.file.buffer, req.file.mimetype);
  let data;
  try {
    data = await prisma.agencyTwilioSettings.upsert({
      where: { agencyId: req.user.agencyId },
      create: { agencyId: req.user.agencyId, customTuneStorageKey: storageKey, customTuneMimeType: req.file.mimetype, customTuneFilename: clean(req.file.originalname, 200), customTuneUploadedAt: new Date() },
      update: { customTuneStorageKey: storageKey, customTuneMimeType: req.file.mimetype, customTuneFilename: clean(req.file.originalname, 200), customTuneUploadedAt: new Date() },
    });
  } catch (error) {
    await removeStorageFile(VOICE_TUNE_BUCKET, storageKey);
    throw error;
  }
  if (existing?.customTuneStorageKey && existing.customTuneStorageKey !== storageKey) {
    await removeStorageFile(VOICE_TUNE_BUCKET, existing.customTuneStorageKey);
  }
  await recordActivity({
    agencyId: req.user.agencyId,
    userId: req.user.id,
    action: "settings.twilio_tune_uploaded",
    details: `Custom tune uploaded: ${data.customTuneFilename}`,
  });
  res.status(201).json({ data: publicSettings(data, true) });
}

export async function getTwilioTune(req, res) {
  const settings = await prisma.agencyTwilioSettings.findUnique({ where: { agencyId: req.user.agencyId } });
  if (!settings?.customTuneStorageKey) throw createHttpError(404, "No custom tune has been uploaded.", "NOT_FOUND");
  const buffer = await downloadStorageFile(VOICE_TUNE_BUCKET, settings.customTuneStorageKey, { allowMissing: true });
  if (!buffer) throw createHttpError(404, "The uploaded tune could not be found.", "NOT_FOUND");
  res.set("Cache-Control", "private, max-age=300");
  res.type(settings.customTuneMimeType || "application/octet-stream");
  res.send(buffer);
}

export async function deleteTwilioTune(req, res) {
  requireAdmin(req);
  const existing = await prisma.agencyTwilioSettings.findUnique({ where: { agencyId: req.user.agencyId } });
  if (!existing?.customTuneStorageKey) return res.status(204).send();
  await prisma.agencyTwilioSettings.update({
    where: { agencyId: req.user.agencyId },
    data: { customTuneStorageKey: null, customTuneMimeType: null, customTuneFilename: null, customTuneUploadedAt: null },
  });
  await removeStorageFile(VOICE_TUNE_BUCKET, existing.customTuneStorageKey);
  await recordActivity({
    agencyId: req.user.agencyId,
    userId: req.user.id,
    action: "settings.twilio_tune_removed",
    details: "Custom tune removed",
  });
  res.status(204).send();
}

export async function deleteTwilioSettings(req, res) {
  requireAdmin(req);
  const existing = await prisma.agencyTwilioSettings.findUnique({ where: { agencyId: req.user.agencyId } });
  if (existing) await prisma.agencyTwilioSettings.delete({ where: { id: existing.id } });
  await recordActivity({
    agencyId: req.user.agencyId,
    userId: req.user.id,
    action: "settings.twilio_disconnected",
    details: "Twilio connection removed",
  });
  res.status(204).send();
}
