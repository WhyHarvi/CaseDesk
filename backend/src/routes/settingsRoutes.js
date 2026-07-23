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
import {
  getAutomatedReminderSettings,
  previewAutomatedReminderPolicy,
  updateAutomatedReminderPolicy,
} from "../controllers/automatedReminderSettingsController.js";
import {
  getExpiringDocumentReminderSettings,
  previewExpiringDocumentReminder,
  updateExpiringDocumentReminderPolicy,
} from "../controllers/expiringDocumentReminderController.js";

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
router.get("/automated-reminders", asyncHandler(getAutomatedReminderSettings));
router.patch("/automated-reminders/:kind", rateLimit({ windowMs: 60_000, max: 30 }), asyncHandler(updateAutomatedReminderPolicy));
router.post("/automated-reminders/:kind/preview", rateLimit({ windowMs: 60_000, max: 60 }), asyncHandler(previewAutomatedReminderPolicy));
router.get("/expiring-document-reminders", asyncHandler(getExpiringDocumentReminderSettings));
router.patch("/expiring-document-reminders/:documentKey", rateLimit({ windowMs: 60_000, max: 30 }), asyncHandler(updateExpiringDocumentReminderPolicy));
router.post("/expiring-document-reminders/:documentKey/preview", rateLimit({ windowMs: 60_000, max: 60 }), asyncHandler(previewExpiringDocumentReminder));

export default router;
