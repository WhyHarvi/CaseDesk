import { Router } from "express";
import { asyncHandler } from "../utils/http.js";
import {
  createTwilioVoiceLine,
  getTwilioVoiceStatus,
  issueTwilioCallToken,
  listTwilioCallAddressBook,
  listTwilioCallNumbers,
  listTwilioCallStaff,
  listTwilioVoiceLines,
  patchTwilioVoiceLine,
  removeTwilioVoiceLine,
  syncTwilioCallHistoryHandler,
  testTwilioCallVoice,
  transferCall,
} from "../controllers/twilioCallController.js";

const router = Router();

router.get("/voice-status", asyncHandler(getTwilioVoiceStatus));
router.post("/token", asyncHandler(issueTwilioCallToken));
router.get("/numbers", asyncHandler(listTwilioCallNumbers));
router.get("/lines", asyncHandler(listTwilioVoiceLines));
router.post("/lines", asyncHandler(createTwilioVoiceLine));
router.patch("/lines/:lineId", asyncHandler(patchTwilioVoiceLine));
router.delete("/lines/:lineId", asyncHandler(removeTwilioVoiceLine));
router.post("/transfer", asyncHandler(transferCall));
router.get("/staff", asyncHandler(listTwilioCallStaff));
router.post("/test", asyncHandler(testTwilioCallVoice));
router.post("/sync", asyncHandler(syncTwilioCallHistoryHandler));
router.get("/address-book", asyncHandler(listTwilioCallAddressBook));

export default router;
