import { Router } from "express";
import requireAuth from "../middleware/authMiddleware.js";
import { requireRole } from "../middleware/authorization.js";
import rateLimit from "../middleware/rateLimit.js";
import { asyncHandler } from "../utils/http.js";
import {
  deletePersonalMailbox,
  getPersonalMailbox,
  patchPersonalMailbox,
  personalMailboxCallback,
  startPersonalMailboxConnect,
} from "../controllers/personalMailboxController.js";

const router = Router();
const teamMember = requireRole("admin", "consultant", "frontdesk");

router.get("/microsoft/callback", rateLimit({ windowMs: 15 * 60_000, max: 30 }), asyncHandler(personalMailboxCallback));
router.get("/me", requireAuth, teamMember, asyncHandler(getPersonalMailbox));
router.post("/microsoft/connect", requireAuth, teamMember, rateLimit({ windowMs: 15 * 60_000, max: 10 }), asyncHandler(startPersonalMailboxConnect));
router.patch("/me", requireAuth, teamMember, asyncHandler(patchPersonalMailbox));
router.delete("/me", requireAuth, teamMember, asyncHandler(deletePersonalMailbox));

export default router;
