import { Router } from "express";
import {
  deleteMailSettings,
  getMailSettings,
  saveMailSettings,
  testMailSettings,
} from "../controllers/settingsController.js";
import { asyncHandler } from "../utils/http.js";
import {
  deleteTwilioSettings,
  deleteTwilioTune,
  getTwilioSettings,
  getTwilioTune,
  saveTwilioSettings,
  testTwilioSms,
  uploadTwilioTune,
  verifyTwilioCredentials,
} from "../controllers/twilioSettingsController.js";
import { deleteAgencyAvatar, getAgencyAvatar, getAgencyProfile, updateAgencyProfile } from "../controllers/agencyProfileController.js";
import { receiveProfileAvatar } from "../middleware/profileAvatarUpload.js";
import { receiveAudioTune } from "../middleware/audioTuneUploadMiddleware.js";
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
router.patch("/agency-profile", receiveProfileAvatar, asyncHandler(updateAgencyProfile));
router.get("/agency-profile/avatar", asyncHandler(getAgencyAvatar));
router.delete("/agency-profile/avatar", asyncHandler(deleteAgencyAvatar));
router.get("/mail", asyncHandler(getMailSettings));
router.put("/mail", asyncHandler(saveMailSettings));
router.post("/mail/test", asyncHandler(testMailSettings));
router.delete("/mail", asyncHandler(deleteMailSettings));
router.get("/twilio", asyncHandler(getTwilioSettings));
router.put("/twilio", asyncHandler(saveTwilioSettings));
router.post("/twilio/verify", asyncHandler(verifyTwilioCredentials));
router.post("/twilio/test-sms", rateLimit({ windowMs: 60_000, max: 5 }), asyncHandler(testTwilioSms));
router.delete("/twilio", asyncHandler(deleteTwilioSettings));
router.post("/twilio/tune", receiveAudioTune, asyncHandler(uploadTwilioTune));
router.get("/twilio/tune", asyncHandler(getTwilioTune));
router.delete("/twilio/tune", asyncHandler(deleteTwilioTune));
router.get("/automated-reminders", asyncHandler(getAutomatedReminderSettings));
router.patch("/automated-reminders/:kind", rateLimit({ windowMs: 60_000, max: 30 }), asyncHandler(updateAutomatedReminderPolicy));
router.post("/automated-reminders/:kind/preview", rateLimit({ windowMs: 60_000, max: 60 }), asyncHandler(previewAutomatedReminderPolicy));
router.get("/expiring-document-reminders", asyncHandler(getExpiringDocumentReminderSettings));
router.patch("/expiring-document-reminders/:documentKey", rateLimit({ windowMs: 60_000, max: 30 }), asyncHandler(updateExpiringDocumentReminderPolicy));
router.post("/expiring-document-reminders/:documentKey/preview", rateLimit({ windowMs: 60_000, max: 60 }), asyncHandler(previewExpiringDocumentReminder));

export default router;
