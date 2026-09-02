import twilio from "twilio";
import { logger } from "../services/logger.js";
import prisma from "../services/prisma/client.js";
import { decryptSecret } from "../services/secretEncryption.js";
import { normalizeCommunicationPhone } from "../services/communicationAddressService.js";
import { ingestInboundCommunication } from "./communicationWebhookController.js";
import { createHttpError } from "../utils/http.js";
import { VOICE_TUNE_BUCKET, downloadStorageFile } from "../services/supabaseStorage.js";
import {
  cancelSiblingRingDispatches,
  dequeueTwiML,
  handleTwilioCallStatus,
  inboundTwiML,
  inboundVoicemailTwiML,
  inboundWaitTwiML,
  markRingDispatchAnswered,
  outboundTwiML,
  recordRingDispatchStatus,
  twilioPublicBase,
} from "../services/twilioCallService.js";

// Twilio fetches these TwiML endpoints (voiceMethod POST) and executes the
// returned TwiML. Agency id comes from the URL path — the endpoints themselves
// only ever return dial instructions, never data. An optional line id routes
// the call to just the staff that line's rule targets (e.g. frontdesk only).
export async function twilioInboundTwiML(req, res) {
  const xml = await inboundTwiML(req.params.agencyId, req.params.lineId, req);
  res.type("text/xml").send(xml);
}

export async function twilioOutboundTwiML(req, res) {
  const xml = await outboundTwiML(req.params.agencyId, req);
  res.type("text/xml").send(xml);
}

// Status + recording callbacks from Twilio. Always answer 200 — a callback
// failure is logged, never surfaced to Twilio as a retry loop for call audio.
export async function twilioCallStatus(req, res) {
  // TwiML callback URLs carry stable call context (such as the original
  // inbound caller and parent SID) in their query string. Merge it after
  // Twilio's POST fields so that child browser-leg values cannot erase it.
  const callback = { ...(req.body || {}), ...(req.query || {}) };
  try {
    await handleTwilioCallStatus({ agencyId: req.params.agencyId, body: callback });
  } catch (error) {
    logger.warn("twilio.status_callback_failed", { agencyId: req.params.agencyId, callSid: req.body?.CallSid, reason: error.message });
  }
  // handleTwilioCallStatus's own isDialAction check is the same one used
  // here: DialCallStatus only ever appears on the <Dial action> callback,
  // never on a per-<Client> statusCallback ping. This branch only still
  // fires for outboundTwiML's internal-line bridge (still a plain <Dial>)
  // and any in-flight calls from before the inbound flow moved to Queue —
  // callerNumber is only ever set on inboundTwiML's URLs, which no longer
  // produce a DialCallStatus callback at all now that ringing staff is a
  // <Enqueue>, not a <Dial>.
  const dialCallStatus = String(callback.DialCallStatus || "").toLowerCase();
  const unansweredInboundDial =
    callback.DialCallStatus !== undefined &&
    Boolean(callback.callerNumber) &&
    !["completed", "answered"].includes(dialCallStatus);
  // inboundTwiML's <Enqueue action> callback — fires once the caller
  // leaves the queue for any reason (QueueResult: bridged/hangup/leave/
  // redirect/system-error). Whichever staff members are still ringing for
  // this call should stop regardless of outcome; only a genuine timeout
  // (our own <Leave/> from the wait handler, or anything else that isn't a
  // clean bridge/hangup) falls through to voicemail.
  const isQueueResult = callback.QueueResult !== undefined && Boolean(callback.callerNumber);
  if (isQueueResult) {
    const queueResult = String(callback.QueueResult || "").toLowerCase();
    await cancelSiblingRingDispatches(req.params.agencyId, callback.parentCallSid || callback.CallSid).catch((error) => {
      logger.warn("twilio.cancel_ring_dispatches_failed", { agencyId: req.params.agencyId, reason: error.message });
    });
    if (!["bridged", "hangup"].includes(queueResult)) {
      try {
        const voicemailXml = await inboundVoicemailTwiML(req.params.agencyId, callback, req);
        if (voicemailXml) {
          res.type("text/xml").send(voicemailXml);
          return;
        }
      } catch (error) {
        logger.warn("twilio.voicemail_offer_failed", { agencyId: req.params.agencyId, callSid: req.body?.CallSid, reason: error.message });
      }
    }
    res.type("text/xml").send("<Response></Response>");
    return;
  }
  if (unansweredInboundDial) {
    try {
      const voicemailXml = await inboundVoicemailTwiML(req.params.agencyId, callback, req);
      if (voicemailXml) {
        res.type("text/xml").send(voicemailXml);
        return;
      }
    } catch (error) {
      logger.warn("twilio.voicemail_offer_failed", { agencyId: req.params.agencyId, callSid: req.body?.CallSid, reason: error.message });
    }
  }
  // This same URL doubles as outboundTwiML's <Dial action> callback, not
  // just a fire-and-forget statusCallback — an action callback must get a
  // valid TwiML response back, or Twilio flags it as Debugger error 12300
  // ("Invalid Content-Type") since a bare 200 with no body carries no
  // Content-Type at all. An empty <Response/> satisfies both cases: nothing
  // more to do, the call has already ended by the time this fires.
  res.type("text/xml").send("<Response></Response>");
}

// The Voice URL for each dispatched ring attempt (see
// twilioCallService.js's dispatchRingAttempts) — pulls whoever answers
// into the caller's queue. Marking this leg answered happens here, before
// the Dial/Queue TwiML is even returned — see markRingDispatchAnswered for
// why that ordering is what keeps a consultant who just answered from
// being disconnected by their own siblings' cancellation.
export async function twilioDequeue(req, res) {
  const queueName = String(req.query.queueName || "");
  await markRingDispatchAnswered(req.params.agencyId, req.body?.CallSid).catch((error) => {
    logger.warn("twilio.mark_ring_answered_failed", { agencyId: req.params.agencyId, callSid: req.body?.CallSid, reason: error.message });
  });
  res.type("text/xml").send(dequeueTwiML(queueName));
}

// waitUrl for a queued caller — Twilio re-fetches this on a loop for as
// long as they're queued.
export async function twilioWait(req, res) {
  const xml = await inboundWaitTwiML(req.params.agencyId, req.query, req);
  res.type("text/xml").send(xml);
}

// statusCallback for one dispatched ring attempt — records whether that
// specific staff member answered, independent of whether they went on to
// actually connect (the queue result callback above is what knows that).
export async function twilioRingStatus(req, res) {
  try {
    await recordRingDispatchStatus(req.params.agencyId, req.body);
  } catch (error) {
    logger.warn("twilio.ring_status_failed", { agencyId: req.params.agencyId, callSid: req.body?.CallSid, reason: error.message });
  }
  res.type("text/xml").send("<Response></Response>");
}

// What a queued caller's waitUrl <Play> actually fetches — Twilio requests
// media URLs as a plain unauthenticated GET (there's no user session to
// carry), so this can't sit behind the same auth as the settings-page
// preview endpoint. The storage key itself is an unguessable UUID and
// nothing here lists or enumerates it, which is the same level of
// protection most hold-music URLs get in practice.
export async function twilioServeTune(req, res) {
  const settings = await prisma.agencyTwilioSettings.findUnique({ where: { agencyId: req.params.agencyId } });
  if (!settings?.customTuneStorageKey) throw createHttpError(404, "No custom tune is set for this workspace.", "NOT_FOUND");
  const buffer = await downloadStorageFile(VOICE_TUNE_BUCKET, settings.customTuneStorageKey, { allowMissing: true });
  if (!buffer) throw createHttpError(404, "The tune could not be found.", "NOT_FOUND");
  res.set("Cache-Control", "private, max-age=300");
  res.type(settings.customTuneMimeType || "application/octet-stream");
  res.send(buffer);
}

export async function twilioInboundSms(req, res) {
  const agencyId = req.params.agencyId;
  const settings = await prisma.agencyTwilioSettings.findUnique({ where: { agencyId } });
  if (!settings?.authTokenEncrypted) throw createHttpError(404, "Twilio SMS workspace not found");
  const webhookUrl = `${twilioPublicBase(req)}${String(req.originalUrl || "").split("?")[0]}`;
  const signature = req.header("x-twilio-signature") || "";
  if (!twilio.validateRequest(decryptSecret(settings.authTokenEncrypted), signature, webhookUrl, req.body || {})) {
    throw createHttpError(401, "Invalid Twilio webhook signature");
  }
  const destination = normalizeCommunicationPhone(req.body?.To);
  const validNumbers = new Set(
    [settings.voiceNumber, settings.fromNumber, ...(await prisma.agencyTwilioVoiceLine.findMany({ where: { agencyId, enabled: true }, select: { phoneNumber: true } })).map((line) => line.phoneNumber)]
      .map(normalizeCommunicationPhone)
      .filter(Boolean),
  );
  if (!destination || !validNumbers.has(destination)) throw createHttpError(404, "Twilio SMS number not found");
  await ingestInboundCommunication({
    agencyId,
    channel: "Sms",
    provider: "Twilio",
    providerMessageId: req.body?.MessageSid,
    from: req.body?.From,
    to: req.body?.To,
    body: req.body?.Body,
    metadata: { numMedia: Number(req.body?.NumMedia || 0) },
  });
  res.type("text/xml").send("<Response></Response>");
}
