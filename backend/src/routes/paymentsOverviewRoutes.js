import { Router } from "express";
import {
  getPaymentsList,
  getPaymentsSummaryOverview,
} from "../controllers/paymentsOverviewController.js";
import { asyncHandler } from "../utils/http.js";

const router = Router();
router.get("/", asyncHandler(getPaymentsList));
router.get("/summary", asyncHandler(getPaymentsSummaryOverview));

export default router;
