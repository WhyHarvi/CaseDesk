import { Router } from "express";
import { getDeveloperOverview } from "../controllers/developerController.js";
import { asyncHandler } from "../utils/http.js";

const router = Router();
router.get("/overview", asyncHandler(getDeveloperOverview));
export default router;
