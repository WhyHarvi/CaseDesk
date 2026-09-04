import { Router } from "express";
import { chatWithCaseDeskAI, getCaseDeskAIStatus, getCaseDeskProactiveInsight, getNovaPreferences, updateNovaPreferences } from "../controllers/aiController.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { asyncHandler } from "../utils/http.js";

const router = Router();

router.get("/status", asyncHandler(getCaseDeskAIStatus));
router.get("/proactive-insight", rateLimit({ windowMs: 60_000, max: 60 }), asyncHandler(getCaseDeskProactiveInsight));
router.get("/preferences", asyncHandler(getNovaPreferences));
router.patch("/preferences", rateLimit({ windowMs: 60_000, max: 30 }), asyncHandler(updateNovaPreferences));
router.post("/chat", rateLimit({ windowMs: 60_000, max: 20 }), asyncHandler(chatWithCaseDeskAI));

export default router;
