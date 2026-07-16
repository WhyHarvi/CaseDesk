import { Router } from "express";
import { getActivityLogById, listActivityLogs } from "../controllers/activityLogController.js";
import { asyncHandler } from "../utils/http.js";

const router = Router();

router.get("/", asyncHandler(listActivityLogs));
router.get("/:id", asyncHandler(getActivityLogById));

export default router;
