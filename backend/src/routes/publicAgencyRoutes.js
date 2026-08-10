import { Router } from "express";
import { getPublicAgencyLogo } from "../controllers/publicAgencyController.js";
import { asyncHandler } from "../utils/http.js";

const router = Router();
router.get("/:agencyId/logo", asyncHandler(getPublicAgencyLogo));
export default router;
