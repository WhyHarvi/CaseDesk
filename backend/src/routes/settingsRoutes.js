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
  getOomaSettings,
  rotateOomaWebhookToken,
  saveOomaSettings,
  testOomaSms,
} from "../controllers/oomaSettingsController.js";
import { getAgencyProfile, updateAgencyProfile } from "../controllers/agencyProfileController.js";

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
router.delete("/ooma", asyncHandler(deleteOomaSettings));

export default router;
