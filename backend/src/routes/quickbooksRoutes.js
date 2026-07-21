import { Router } from "express";
import requireAuth from "../middleware/authMiddleware.js";
import { requireRole } from "../middleware/authorization.js";
import rateLimit from "../middleware/rateLimit.js";
import {
  createQuickBooksMappingItem,
  disconnectQuickBooks,
  getQuickBooksAccounts,
  getQuickBooksItems,
  getQuickBooksMapping,
  getQuickBooksStatus,
  quickBooksCallback,
  startQuickBooksConnect,
  updateQuickBooksMapping,
} from "../controllers/quickbooksController.js";
import { simulateHoldPayment } from "../controllers/quickbooksWebhookController.js";
import { asyncHandler } from "../utils/http.js";

const router = Router();

// Browser redirect target from Intuit — authenticated via signed OAuth state.
router.get("/callback", rateLimit({ windowMs: 15 * 60_000, max: 20 }), asyncHandler(quickBooksCallback));

router.get("/status", requireAuth, requireRole("admin"), asyncHandler(getQuickBooksStatus));
router.post("/connect", requireAuth, requireRole("admin"), rateLimit({ windowMs: 15 * 60_000, max: 10 }), asyncHandler(startQuickBooksConnect));
router.post("/disconnect", requireAuth, requireRole("admin"), asyncHandler(disconnectQuickBooks));
router.get("/items", requireAuth, requireRole("admin"), asyncHandler(getQuickBooksItems));
router.post("/items", requireAuth, requireRole("admin"), rateLimit({ windowMs: 15 * 60_000, max: 20 }), asyncHandler(createQuickBooksMappingItem));
router.get("/accounts", requireAuth, requireRole("admin"), asyncHandler(getQuickBooksAccounts));
router.get("/mapping", requireAuth, requireRole("admin"), asyncHandler(getQuickBooksMapping));
router.put("/mapping", requireAuth, requireRole("admin"), asyncHandler(updateQuickBooksMapping));

// Dev/staging only — see simulateHoldPayment. Real webhook traffic from
// Intuit lands on the separate, unauthenticated quickbooksWebhookRoutes.js.
router.post("/webhook/simulate/:holdId", requireAuth, requireRole("admin"), asyncHandler(simulateHoldPayment));

export default router;
