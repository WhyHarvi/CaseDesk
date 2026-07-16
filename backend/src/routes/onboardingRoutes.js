import { Router } from "express";
import { completeAgencyOnboarding, getOnboardingStatus, registerAgency } from "../controllers/onboardingController.js";
import requireOnboardingAuth from "../middleware/onboardingAuth.js";
import rateLimit from "../middleware/rateLimit.js";
import { asyncHandler } from "../utils/http.js";

const router = Router();

router.post("/register-agency", rateLimit({ windowMs: 60 * 60_000, max: 5 }), asyncHandler(registerAgency));
router.get("/status", requireOnboardingAuth, asyncHandler(getOnboardingStatus));
router.post("/complete", requireOnboardingAuth, rateLimit({ windowMs: 15 * 60_000, max: 5 }), asyncHandler(completeAgencyOnboarding));

export default router;
