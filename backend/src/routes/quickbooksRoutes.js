import { Router } from "express";
import requireAuth from "../middleware/authMiddleware.js";
import { requireRole } from "../middleware/authorization.js";
import rateLimit from "../middleware/rateLimit.js";
import {
  disconnectQuickBooks,
  getQuickBooksStatus,
  quickBooksCallback,
  startQuickBooksConnect,
} from "../controllers/quickbooksController.js";
import { asyncHandler } from "../utils/http.js";

const router = Router();

// Browser redirect target from Intuit — authenticated via signed OAuth state.
router.get("/callback", rateLimit({ windowMs: 15 * 60_000, max: 20 }), asyncHandler(quickBooksCallback));

router.get("/status", requireAuth, requireRole("admin"), asyncHandler(getQuickBooksStatus));
router.post("/connect", requireAuth, requireRole("admin"), rateLimit({ windowMs: 15 * 60_000, max: 10 }), asyncHandler(startQuickBooksConnect));
router.post("/disconnect", requireAuth, requireRole("admin"), asyncHandler(disconnectQuickBooks));

export default router;
