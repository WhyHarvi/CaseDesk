import { Router } from "express";
import {
  createFollowUp,
  cancelFollowUp,
  getFollowUpById,
  listFollowUps,
  listMyWork,
  listFollowUpOptions,
  updateFollowUp,
} from "../controllers/followUpController.js";
import { asyncHandler } from "../utils/http.js";

const router = Router();

router.get("/combined", asyncHandler(listMyWork));
router.get("/", asyncHandler(listFollowUps));
router.get("/options", asyncHandler(listFollowUpOptions));
router.get("/:id", asyncHandler(getFollowUpById));
router.post("/", asyncHandler(createFollowUp));
router.patch("/:id", asyncHandler(updateFollowUp));
router.patch("/:id/cancel", asyncHandler(cancelFollowUp));

export default router;
