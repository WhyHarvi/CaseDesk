import { Router } from "express";
import {
  getPaymentsList,
  getRefundReview,
  getPaymentsSummaryOverview,
} from "../controllers/paymentsOverviewController.js";
import { asyncHandler } from "../utils/http.js";

const router = Router();
router.get("/", asyncHandler(getPaymentsList));
router.get("/summary", asyncHandler(getPaymentsSummaryOverview));
router.get("/refunds/:id", asyncHandler(getRefundReview));

export default router;
