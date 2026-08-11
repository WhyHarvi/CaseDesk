import { Router } from "express";
import {
  getPaymentsList,
  getRefundReview,
  getPaymentsSummaryOverview,
  getPaymentApprovals,
  approvePayment,
  rejectPayment,
} from "../controllers/paymentsOverviewController.js";
import { asyncHandler } from "../utils/http.js";

const router = Router();
router.get("/", asyncHandler(getPaymentsList));
router.get("/summary", asyncHandler(getPaymentsSummaryOverview));
router.get("/approvals", asyncHandler(getPaymentApprovals));
router.post("/approvals/:id/approve", asyncHandler(approvePayment));
router.post("/approvals/:id/reject", asyncHandler(rejectPayment));
router.get("/refunds/:id", asyncHandler(getRefundReview));

export default router;
