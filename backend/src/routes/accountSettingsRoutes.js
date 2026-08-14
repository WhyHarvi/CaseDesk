import { Router } from "express";
import { getAccountActivity, getAccountSecurity } from "../controllers/accountSettingsController.js";
import { deleteMyFormSignature, getMyFormSignature, updateMyFormSignature, updateMyRepresentativeProfile } from "../controllers/formSignatureProfileController.js";
import { asyncHandler } from "../utils/http.js";
import { rateLimit } from "../middleware/rateLimit.js";

const router = Router();

router.get("/security", rateLimit({ windowMs: 60_000, max: 60 }), asyncHandler(getAccountSecurity));
router.get("/activity", rateLimit({ windowMs: 60_000, max: 120 }), asyncHandler(getAccountActivity));
router.get("/form-signature", rateLimit({ windowMs: 60_000, max: 60 }), asyncHandler(getMyFormSignature));
router.patch("/form-representative-profile", rateLimit({ windowMs: 60_000, max: 20 }), asyncHandler(updateMyRepresentativeProfile));
router.put("/form-signature", rateLimit({ windowMs: 60_000, max: 10 }), asyncHandler(updateMyFormSignature));
router.delete("/form-signature", rateLimit({ windowMs: 60_000, max: 10 }), asyncHandler(deleteMyFormSignature));

export default router;
