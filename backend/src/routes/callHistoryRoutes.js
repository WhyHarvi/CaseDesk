import { Router } from "express";
import { asyncHandler } from "../utils/http.js";
import {
  createLeadFromCall,
  getCall,
  linkCallToClient,
  linkCallToLead,
  listCallCandidates,
  listCalls,
  markCallSpam,
  recordCallOutcome,
} from "../controllers/callHistoryController.js";

const router = Router();

router.get("/", asyncHandler(listCalls));
router.get("/:id", asyncHandler(getCall));
router.get("/:id/candidates", asyncHandler(listCallCandidates));
router.post("/:id/link-lead", asyncHandler(linkCallToLead));
router.post("/:id/link-client", asyncHandler(linkCallToClient));
router.post("/:id/create-lead", asyncHandler(createLeadFromCall));
router.post("/:id/spam", asyncHandler(markCallSpam));
router.post("/:id/outcome", asyncHandler(recordCallOutcome));

export default router;
