import { Router } from "express";
import rateLimit from "../middleware/rateLimit.js";
import { asyncHandler } from "../utils/http.js";
import {
  getPreConsultationIntake,
  submitPreConsultationIntake,
} from "../controllers/preConsultationIntakeController.js";

const router = Router();
const readLimit = rateLimit({ windowMs: 60_000, max: 60 });
const submitLimit = rateLimit({ windowMs: 15 * 60_000, max: 10 });

router.get("/:manageToken", readLimit, asyncHandler(getPreConsultationIntake));
router.post("/:manageToken", submitLimit, asyncHandler(submitPreConsultationIntake));

export default router;
