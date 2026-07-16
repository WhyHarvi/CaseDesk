import { Router } from "express";
import {
  receiveCommunicationEventWebhook,
  receiveCommunicationInboundWebhook,
  receiveOomaCommunicationWebhook,
} from "../controllers/communicationWebhookController.js";
import { asyncHandler } from "../utils/http.js";

const router = Router();
router.post("/ooma/:token", asyncHandler(receiveOomaCommunicationWebhook));
router.post("/inbound", asyncHandler(receiveCommunicationInboundWebhook));
router.post("/events", asyncHandler(receiveCommunicationEventWebhook));

export default router;
