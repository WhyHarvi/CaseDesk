import { Router } from "express";
import { rateLimit } from "../../middleware/rateLimit.js";
import { asyncHandler } from "../../utils/http.js";
import { receiveEvent } from "./lead.website.controller.js";

const router = Router();
router.post("/:token/events", rateLimit({ windowMs: 60_000, max: 120 }), asyncHandler(receiveEvent));
export default router;

