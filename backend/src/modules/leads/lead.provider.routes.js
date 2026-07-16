import { Router } from "express";
import { rateLimit } from "../../middleware/rateLimit.js";
import { asyncHandler } from "../../utils/http.js";
import { receiveProviderEvent, verifyChallenge } from "./lead.website.controller.js";

const router = Router();
router.get("/:provider/:token/events", rateLimit({ max: 60 }), asyncHandler(verifyChallenge));
router.post("/:provider/:token/events", rateLimit({ windowMs: 60_000, max: 240 }), asyncHandler(receiveProviderEvent));
export default router;

