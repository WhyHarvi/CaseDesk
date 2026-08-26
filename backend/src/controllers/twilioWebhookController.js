import { logger } from "../services/logger.js";
import {
  handleTwilioCallStatus,
  inboundTwiML,
  outboundTwiML,
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
  try {
    // TwiML callback URLs carry stable call context (such as the original
    // inbound caller and parent SID) in their query string. Merge it after
    // Twilio's POST fields so that child browser-leg values cannot erase it.
    const callback = { ...(req.body || {}), ...(req.query || {}) };
    await handleTwilioCallStatus({ agencyId: req.params.agencyId, body: callback });
  } catch (error) {
    logger.warn("twilio.status_callback_failed", { agencyId: req.params.agencyId, callSid: req.body?.CallSid, reason: error.message });
  }
  // This same URL doubles as outboundTwiML's <Dial action> callback, not
  // just a fire-and-forget statusCallback — an action callback must get a
  // valid TwiML response back, or Twilio flags it as Debugger error 12300
  // ("Invalid Content-Type") since a bare 200 with no body carries no
  // Content-Type at all. An empty <Response/> satisfies both cases: nothing
  // more to do, the call has already ended by the time this fires.
  res.type("text/xml").send("<Response></Response>");
}
