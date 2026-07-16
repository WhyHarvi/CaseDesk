import { Router } from "express";
import { getDashboardSummary } from "../controllers/dashboardController.js";
import { asyncHandler } from "../utils/http.js";

const router = Router();

router.get("/", asyncHandler(getDashboardSummary));

export default router;
