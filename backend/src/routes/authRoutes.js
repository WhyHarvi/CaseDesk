import { Router } from "express";
import { acceptMemberInvitation, changePassword, getInvitation, getMe, logout } from "../controllers/authController.js";
import requireAuth from "../middleware/authMiddleware.js";
import requireInvitationAuth from "../middleware/invitationAuth.js";
import { asyncHandler } from "../utils/http.js";
import rateLimit from "../middleware/rateLimit.js";

const router = Router();
router.get("/invitation", requireInvitationAuth, asyncHandler(getInvitation));
router.post("/accept-invitation", requireInvitationAuth, rateLimit({ windowMs: 15 * 60_000, max: 5 }), asyncHandler(acceptMemberInvitation));
router.get("/me", requireAuth, asyncHandler(getMe));
router.post("/logout", requireAuth, asyncHandler(logout));
router.post("/change-password", requireAuth, rateLimit({ windowMs: 15 * 60_000, max: 5 }), asyncHandler(changePassword));
export default router;
