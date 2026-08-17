import { Router } from "express";
import { chatWithCaseDeskAI, getCaseDeskAIStatus, getCaseDeskProactiveInsight } from "../controllers/aiController.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { asyncHandler } from "../utils/http.js";

const router = Router();

router.get("/status", asyncHandler(getCaseDeskAIStatus));
router.get("/proactive-insight", rateLimit({ windowMs: 60_000, max: 60 }), asyncHandler(getCaseDeskProactiveInsight));
router.post("/chat", rateLimit({ windowMs: 60_000, max: 20 }), asyncHandler(chatWithCaseDeskAI));

export default router;
