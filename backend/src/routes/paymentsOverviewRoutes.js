import { Router } from "express";
import { requireRole } from "../middleware/authorization.js";
import { getPaymentsList, getPaymentsSummaryOverview } from "../controllers/paymentsOverviewController.js";
import { asyncHandler } from "../utils/http.js";

const router = Router();
router.use(requireRole("admin"));

router.get("/", asyncHandler(getPaymentsList));
router.get("/summary", asyncHandler(getPaymentsSummaryOverview));

export default router;
