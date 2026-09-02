import { Router } from "express";
import {
  receiveCommunicationEventWebhook,
  receiveCommunicationInboundWebhook,
} from "../controllers/communicationWebhookController.js";
import {
  twilioCallStatus,
  twilioDequeue,
  twilioInboundSms,
  twilioInboundTwiML,
  twilioOutboundTwiML,
  twilioRingStatus,
  twilioServeTune,
  twilioWait,
} from "../controllers/twilioWebhookController.js";
import { asyncHandler } from "../utils/http.js";

const router = Router();
router.post("/inbound", asyncHandler(receiveCommunicationInboundWebhook));
router.post("/events", asyncHandler(receiveCommunicationEventWebhook));
// Twilio Voice — the number's Voice webhook and the TwiML Application's
// Voice URL point here; Twilio fetches these directly (no CaseDesk auth).
router.post("/twilio/inbound/:agencyId", asyncHandler(twilioInboundTwiML));
router.post("/twilio/inbound/:agencyId/:lineId", asyncHandler(twilioInboundTwiML));
router.post("/twilio/outbound/:agencyId", asyncHandler(twilioOutboundTwiML));
router.post("/twilio/status/:agencyId", asyncHandler(twilioCallStatus));
router.post("/twilio/sms/:agencyId", asyncHandler(twilioInboundSms));
// Queue-based hold experience: dequeue is each dispatched ring attempt's
// Voice URL, wait is the queued caller's waitUrl (fetched repeatedly while
// they wait), ring-status is that same ring attempt's statusCallback, and
// tune is what a queued caller's <Play> actually fetches — all Twilio-
// initiated, no CaseDesk auth, same as the rest of this file.
router.post("/twilio/dequeue/:agencyId", asyncHandler(twilioDequeue));
router.post("/twilio/wait/:agencyId", asyncHandler(twilioWait));
router.post("/twilio/ring-status/:agencyId", asyncHandler(twilioRingStatus));
router.get("/twilio/tune/:agencyId", asyncHandler(twilioServeTune));

export default router;
