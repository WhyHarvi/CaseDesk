import { Router } from "express";
import requireAuth from "../middleware/authMiddleware.js";
import { requireRole } from "../middleware/authorization.js";
import rateLimit from "../middleware/rateLimit.js";
import {
  disconnectZoom,
  getZoomStatus,
  startZoomConnect,
  updateZoomMappings,
  zoomOAuthCallback,
  zoomWebhook,
} from "../controllers/zoomController.js";
import { asyncHandler } from "../utils/http.js";

const router = Router();
const admin = [requireAuth, requireRole("admin")];

router.get("/callback", rateLimit({ windowMs: 15 * 60_000, max: 20 }), asyncHandler(zoomOAuthCallback));
router.post("/webhook", rateLimit({ windowMs: 60_000, max: 300 }), asyncHandler(zoomWebhook));
router.get("/status", ...admin, asyncHandler(getZoomStatus));
router.post("/connect", ...admin, rateLimit({ windowMs: 15 * 60_000, max: 10 }), asyncHandler(startZoomConnect));
router.put("/mappings", ...admin, asyncHandler(updateZoomMappings));
router.post("/disconnect", ...admin, asyncHandler(disconnectZoom));

export default router;
