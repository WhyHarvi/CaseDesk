import { Router } from "express";
import {
  deleteMailSettings,
  getMailSettings,
  saveMailSettings,
  testMailSettings,
} from "../controllers/settingsController.js";
import { asyncHandler } from "../utils/http.js";
import {
  deleteOomaSettings,
  deleteZapierOutboundWebhook,
  getOomaSettings,
  rotateOomaWebhookToken,
  saveZapierOutboundWebhook,
  saveOomaSettings,
  testOomaSms,
  testZapierOutboundSms,
} from "../controllers/oomaSettingsController.js";
import { getAgencyProfile, updateAgencyProfile } from "../controllers/agencyProfileController.js";
import { rateLimit } from "../middleware/rateLimit.js";

const router = Router();
router.get("/agency-profile", asyncHandler(getAgencyProfile));
router.patch("/agency-profile", asyncHandler(updateAgencyProfile));
router.get("/mail", asyncHandler(getMailSettings));
router.put("/mail", asyncHandler(saveMailSettings));
router.post("/mail/test", asyncHandler(testMailSettings));
router.delete("/mail", asyncHandler(deleteMailSettings));
router.get("/ooma", asyncHandler(getOomaSettings));
router.put("/ooma", asyncHandler(saveOomaSettings));
router.post("/ooma/test-sms", asyncHandler(testOomaSms));
router.post("/ooma/webhook-token", asyncHandler(rotateOomaWebhookToken));
router.put("/ooma/zapier-outbound", asyncHandler(saveZapierOutboundWebhook));
router.post("/ooma/zapier-outbound/test-sms", rateLimit({ windowMs: 60_000, max: 5 }), asyncHandler(testZapierOutboundSms));
router.delete("/ooma/zapier-outbound", asyncHandler(deleteZapierOutboundWebhook));
router.delete("/ooma", asyncHandler(deleteOomaSettings));

export default router;
