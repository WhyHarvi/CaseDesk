import {
  getConsultationRefundReview,
  getPaymentsSummary,
  listAgencyPayments,
} from "../services/paymentsOverviewService.js";
import { createHttpError } from "../utils/http.js";
import { approvePaymentApproval, listPaymentApprovals, rejectPaymentApproval } from "../services/paymentApprovalService.js";

function requireAdmin(req) {
  if (req.auth.role !== "admin") throw createHttpError(403, "Only an administrator can review staff-entered payments.", "FORBIDDEN");
}

export async function getPaymentsList(req, res) {
  const { status, source, query, from, to, page, pageSize } = req.query;
  const data = await listAgencyPayments(req.auth.agencyId, {
    status: status || undefined,
    source: source || undefined,
    query: query || undefined,
    from: from || undefined,
    to: to || undefined,
    page: page ? Number(page) : 1,
    pageSize: pageSize ? Math.min(Number(pageSize), 100) : 25,
  });
  res.json({ data });
}

export async function getPaymentsSummaryOverview(req, res) {
  const data = await getPaymentsSummary(req.auth.agencyId);
  res.json({ data });
}

export async function getRefundReview(req, res) {
  const refundReceiptId = String(req.params.id || "").trim();
  if (!refundReceiptId || refundReceiptId.length > 120) {
    throw createHttpError(400, "Refund receipt ID is invalid.", "VALIDATION_ERROR");
  }
  const data = await getConsultationRefundReview(
    req.auth.agencyId,
    refundReceiptId,
  );
  res.json({ data });
}

export async function getPaymentApprovals(req, res) {
  requireAdmin(req);
  const data = await listPaymentApprovals(req.auth.agencyId, req.query);
  res.json({ data });
}

export async function approvePayment(req, res) {
  requireAdmin(req);
  const data = await approvePaymentApproval(req.auth.agencyId, req.params.id, req.auth.userId);
  res.json({ data });
}

export async function rejectPayment(req, res) {
  requireAdmin(req);
  const data = await rejectPaymentApproval(req.auth.agencyId, req.params.id, req.auth.userId, req.body?.reason);
  res.json({ data });
}
