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
  recordOutboundCallOutcome,
  removeTwilioVoiceLine,
  saveActiveTwilioCallNote,
  startRecording,
  stopRecording,
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
router.post("/recording/start", asyncHandler(startRecording));
router.post("/recording/stop", asyncHandler(stopRecording));
router.post("/outcome", asyncHandler(recordOutboundCallOutcome));
router.put("/active-note", asyncHandler(saveActiveTwilioCallNote));
router.get("/staff", asyncHandler(listTwilioCallStaff));
router.post("/test", asyncHandler(testTwilioCallVoice));
router.post("/sync", asyncHandler(syncTwilioCallHistoryHandler));
router.get("/address-book", asyncHandler(listTwilioCallAddressBook));

export default router;
