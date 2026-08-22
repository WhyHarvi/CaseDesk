import { Router } from "express";
import { getAccountActivity, getAccountSecurity } from "../controllers/accountSettingsController.js";
import { deleteMyFormSignature, getMyFormSignature, updateMyFormSignature, updateMyRepresentativeProfile } from "../controllers/formSignatureProfileController.js";
import { getAgencyOfficeContact } from "../controllers/agencyProfileController.js";
import { getGovernmentFormSettings, updateGovernmentFormSettings } from "../controllers/governmentFormSettingsController.js";
import { asyncHandler } from "../utils/http.js";
import { rateLimit } from "../middleware/rateLimit.js";

const router = Router();

router.get("/security", rateLimit({ windowMs: 60_000, max: 60 }), asyncHandler(getAccountSecurity));
router.get("/activity", rateLimit({ windowMs: 60_000, max: 120 }), asyncHandler(getAccountActivity));
router.get("/agency-office-contact", rateLimit({ windowMs: 60_000, max: 60 }), asyncHandler(getAgencyOfficeContact));
router.get("/form-signature", rateLimit({ windowMs: 60_000, max: 60 }), asyncHandler(getMyFormSignature));
router.patch("/form-representative-profile", rateLimit({ windowMs: 60_000, max: 20 }), asyncHandler(updateMyRepresentativeProfile));
router.put("/form-signature", rateLimit({ windowMs: 60_000, max: 10 }), asyncHandler(updateMyFormSignature));
router.delete("/form-signature", rateLimit({ windowMs: 60_000, max: 10 }), asyncHandler(deleteMyFormSignature));
// Agency-wide, but deliberately open to any staff member — see
// governmentFormSettingsController.js for why.
router.get("/government-forms", rateLimit({ windowMs: 60_000, max: 60 }), asyncHandler(getGovernmentFormSettings));
router.put("/government-forms", rateLimit({ windowMs: 60_000, max: 20 }), asyncHandler(updateGovernmentFormSettings));

export default router;
