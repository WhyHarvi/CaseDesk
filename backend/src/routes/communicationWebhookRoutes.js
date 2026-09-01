import { Router } from "express";
import {
  receiveCommunicationEventWebhook,
  receiveCommunicationInboundWebhook,
} from "../controllers/communicationWebhookController.js";
import {
  twilioCallStatus,
  twilioInboundSms,
  twilioInboundTwiML,
  twilioOutboundTwiML,
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

export default router;
