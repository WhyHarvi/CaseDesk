import { Router } from "express";
import { asyncHandler } from "../utils/http.js";
import {
  createLeadFromCall,
  getCall,
  getCallSmsOptions,
  linkCallToClient,
  linkCallToAppointment,
  linkCallToLead,
  listCallCandidates,
  listCalls,
  markCallSpam,
  recordCallOutcome,
  sendCallSms,
} from "../controllers/callHistoryController.js";

const router = Router();

router.get("/", asyncHandler(listCalls));
router.get("/:id", asyncHandler(getCall));
router.get("/:id/sms-options", asyncHandler(getCallSmsOptions));
router.get("/:id/candidates", asyncHandler(listCallCandidates));
router.post("/:id/link-lead", asyncHandler(linkCallToLead));
router.post("/:id/link-client", asyncHandler(linkCallToClient));
router.post("/:id/link-appointment", asyncHandler(linkCallToAppointment));
router.post("/:id/create-lead", asyncHandler(createLeadFromCall));
router.post("/:id/spam", asyncHandler(markCallSpam));
router.post("/:id/outcome", asyncHandler(recordCallOutcome));
router.post("/:id/sms", asyncHandler(sendCallSms));

export default router;
