import { Router } from "express";
import { acceptMemberInvitation, changePassword, getAccessSnapshot, getInvitation, getMe, logout, requestPasswordRecovery } from "../controllers/authController.js";
import requireAuth from "../middleware/authMiddleware.js";
import requireInvitationAuth from "../middleware/invitationAuth.js";
import { asyncHandler } from "../utils/http.js";
import rateLimit from "../middleware/rateLimit.js";

const router = Router();
router.post(
  "/forgot-password",
  rateLimit({ windowMs: 15 * 60_000, max: 10 }),
  rateLimit({
    windowMs: 60 * 60_000,
    max: 5,
    identity: (req) => `email:${String(req.body?.email || "").trim().toLowerCase()}`,
  }),
  asyncHandler(requestPasswordRecovery),
);
router.get("/invitation", requireInvitationAuth, asyncHandler(getInvitation));
router.post("/accept-invitation", requireInvitationAuth, rateLimit({ windowMs: 15 * 60_000, max: 5 }), asyncHandler(acceptMemberInvitation));
router.get("/me", requireAuth, asyncHandler(getMe));
router.get("/access", requireAuth, asyncHandler(getAccessSnapshot));
router.post("/logout", requireAuth, asyncHandler(logout));
router.post("/change-password", requireAuth, rateLimit({ windowMs: 15 * 60_000, max: 5 }), asyncHandler(changePassword));
export default router;
