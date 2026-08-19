import { Router } from "express";
import { myWorkload } from "../controllers/adminConsultantController.js";
import { requireRole } from "../middleware/authorization.js";
import { asyncHandler } from "../utils/http.js";
import { deleteMyAvatar, getMyAvatar, getMyProfile, updateMyProfile } from "../controllers/consultantProfileController.js";
import { receiveProfileAvatar } from "../middleware/profileAvatarUpload.js";
import {
  createCollaborationRequest,
  listMyRequests,
  listOpenCases,
  withdrawMyRequest,
} from "../controllers/caseCollaborationController.js";
import rateLimit from "../middleware/rateLimit.js";
const router = Router();
router.get("/me/profile", requireRole("consultant", "frontdesk"), asyncHandler(getMyProfile));
router.patch("/me/profile", requireRole("consultant", "frontdesk"), receiveProfileAvatar, asyncHandler(updateMyProfile));
router.get("/me/avatar", requireRole("consultant", "frontdesk"), asyncHandler(getMyAvatar));
router.delete("/me/avatar", requireRole("consultant", "frontdesk"), asyncHandler(deleteMyAvatar));
router.use(requireRole("consultant"));
router.get("/me/workload", asyncHandler(myWorkload));
router.get("/me/open-cases", asyncHandler(listOpenCases));
router.get("/me/collaboration-requests", asyncHandler(listMyRequests));
router.post(
  "/me/collaboration-requests",
  rateLimit({ windowMs: 60_000, max: 20 }),
  asyncHandler(createCollaborationRequest),
);
router.delete("/me/collaboration-requests/:id", asyncHandler(withdrawMyRequest));
export default router;
