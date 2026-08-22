import { Router } from "express";
import {
  getPaymentsList,
  getRefundReview,
  getPaymentsSummaryOverview,
  getPaymentApprovals,
  getPaymentApprovalDetail,
  approvePayment,
  rejectPayment,
  getCashClosing,
  closeCash,
  postCashWithdrawal,
  getStuckInvoiceRefunds,
  failInvoiceRefund,
  getCashLedgerActivity,
  getQuickBooksSyncFailures,
} from "../controllers/paymentsOverviewController.js";
import { asyncHandler } from "../utils/http.js";
import { requireRole } from "../middleware/authorization.js";
import * as customLedgers from "../controllers/customPaymentLedgerController.js";

const router = Router();
router.get("/custom-ledgers", asyncHandler(customLedgers.list));
router.post("/custom-ledgers", requireRole("admin"), asyncHandler(customLedgers.create));
router.patch("/custom-ledgers/:id", requireRole("admin"), asyncHandler(customLedgers.update));
router.get("/", asyncHandler(getPaymentsList));
router.get("/summary", asyncHandler(getPaymentsSummaryOverview));
router.get("/cash-closing", asyncHandler(getCashClosing));
router.post("/cash-closing", asyncHandler(closeCash));
router.post("/cash-withdrawals", asyncHandler(postCashWithdrawal));
router.get("/approvals", asyncHandler(getPaymentApprovals));
router.get("/approvals/:id", asyncHandler(getPaymentApprovalDetail));
router.post("/approvals/:id/approve", asyncHandler(approvePayment));
router.post("/approvals/:id/reject", asyncHandler(rejectPayment));
router.get("/refunds/:id", asyncHandler(getRefundReview));
router.get("/invoice-refunds/stuck", asyncHandler(getStuckInvoiceRefunds));
router.post("/invoice-refunds/:id/fail", asyncHandler(failInvoiceRefund));
router.get("/cash-ledger-activity", asyncHandler(getCashLedgerActivity));
router.get("/quickbooks-sync-failures", asyncHandler(getQuickBooksSyncFailures));

export default router;
