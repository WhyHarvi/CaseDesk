import { Router } from "express";
import { asyncHandler } from "../utils/http.js";
import {
  createLeadFromCall,
  getCall,
  listCallContactHistory,
  getCallSmsOptions,
  getCallSmsThread,
  linkCallToClient,
  linkCallToAppointment,
  linkCallToLead,
  listCallCandidates,
  listCallPerformance,
  listCalls,
  markCallSpam,
  markCallRecordingPlayed,
  recordCallOutcome,
  sendCallSms,
  streamCallRecording,
} from "../controllers/callHistoryController.js";

const router = Router();

router.get("/", asyncHandler(listCalls));
router.get("/performance", asyncHandler(listCallPerformance));
router.get("/:id/history", asyncHandler(listCallContactHistory));
router.get("/:id/recording", asyncHandler(streamCallRecording));
router.post("/:id/recording-played", asyncHandler(markCallRecordingPlayed));
router.get("/:id/sms-options", asyncHandler(getCallSmsOptions));
router.get("/:id/sms-thread", asyncHandler(getCallSmsThread));
router.get("/:id/candidates", asyncHandler(listCallCandidates));
router.get("/:id", asyncHandler(getCall));
router.post("/:id/link-lead", asyncHandler(linkCallToLead));
router.post("/:id/link-client", asyncHandler(linkCallToClient));
router.post("/:id/link-appointment", asyncHandler(linkCallToAppointment));
router.post("/:id/create-lead", asyncHandler(createLeadFromCall));
router.post("/:id/spam", asyncHandler(markCallSpam));
router.post("/:id/outcome", asyncHandler(recordCallOutcome));
router.post("/:id/sms", asyncHandler(sendCallSms));

export default router;
