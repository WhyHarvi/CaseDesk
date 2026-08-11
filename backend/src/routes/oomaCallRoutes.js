import { Router } from "express";
import { asyncHandler } from "../utils/http.js";
import {
  createLeadFromOomaCall,
  getOomaCallAttention,
  getOomaCall,
  linkOomaCallToClient,
  linkOomaCallToLead,
  listOomaCallCandidates,
  listOomaCalls,
  markOomaCallSpam,
  recordOomaCallOutcome,
} from "../controllers/oomaCallController.js";

const router = Router();

router.get("/", asyncHandler(listOomaCalls));
router.get("/attention", asyncHandler(getOomaCallAttention));
router.get("/:id", asyncHandler(getOomaCall));
router.get("/:id/candidates", asyncHandler(listOomaCallCandidates));
router.post("/:id/link-lead", asyncHandler(linkOomaCallToLead));
router.post("/:id/link-client", asyncHandler(linkOomaCallToClient));
router.post("/:id/create-lead", asyncHandler(createLeadFromOomaCall));
router.post("/:id/spam", asyncHandler(markOomaCallSpam));
router.post("/:id/outcome", asyncHandler(recordOomaCallOutcome));

export default router;
