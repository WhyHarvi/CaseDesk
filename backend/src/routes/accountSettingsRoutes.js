import { Router } from "express";
import { getAccountActivity, getAccountSecurity } from "../controllers/accountSettingsController.js";
import { asyncHandler } from "../utils/http.js";
import { rateLimit } from "../middleware/rateLimit.js";

const router = Router();

router.get("/security", rateLimit({ windowMs: 60_000, max: 60 }), asyncHandler(getAccountSecurity));
router.get("/activity", rateLimit({ windowMs: 60_000, max: 120 }), asyncHandler(getAccountActivity));

export default router;
