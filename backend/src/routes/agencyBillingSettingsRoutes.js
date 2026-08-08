import { Router } from "express";
import { deleteRetainerSignature, getBillingSettings, updateBillingTaxSettings, updateRetainerSignature } from "../controllers/agencyBillingSettingsController.js";
import { asyncHandler } from "../utils/http.js";

const router = Router();
router.get("/", asyncHandler(getBillingSettings));
router.patch("/", asyncHandler(updateBillingTaxSettings));
router.put("/retainer-signature", asyncHandler(updateRetainerSignature));
router.delete("/retainer-signature", asyncHandler(deleteRetainerSignature));
export default router;
