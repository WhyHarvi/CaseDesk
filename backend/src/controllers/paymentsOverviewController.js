import {
  getConsultationRefundReview,
  getPaymentsSummary,
  getCashReconciliation,
  closeCashReconciliation,
  withdrawCash,
  listAgencyPayments,
  listStuckInvoiceRefunds,
  listCashLedgerActivity,
  listQuickBooksSyncFailures,
} from "../services/paymentsOverviewService.js";
import { createHttpError } from "../utils/http.js";
import { approvePaymentApproval, getPaymentApproval, listPaymentApprovals, rejectPaymentApproval } from "../services/paymentApprovalService.js";
import { markInvoiceRefundFailed } from "../services/caseInvoiceService.js";

function requireAdmin(req) {
  if (req.auth.role !== "admin") throw createHttpError(403, "Only an administrator can access this financial operation.", "FORBIDDEN");
}

export async function getPaymentsList(req, res) {
  const { status, source, ledgerId, query, from, to, bucket, page, pageSize } = req.query;
  const data = await listAgencyPayments(req.auth.agencyId, {
    status: status || undefined,
    source: source || undefined,
    ledgerId: ledgerId || undefined,
    query: query || undefined,
    from: from || undefined,
    to: to || undefined,
    bucket: bucket || undefined,
    page: page ? Number(page) : 1,
    pageSize: pageSize ? Math.min(Number(pageSize), 100) : 25,
  });
  res.json({ data });
}

export async function getPaymentsSummaryOverview(req, res) {
  const data = await getPaymentsSummary(req.auth.agencyId, { month: req.query.month });
  res.json({ data });
}

export async function getCashClosing(req, res) {
  requireAdmin(req);
  res.json({ data: await getCashReconciliation(req.auth.agencyId, req.query.day) });
}

export async function closeCash(req, res) {
  requireAdmin(req);
  res.json({ data: await closeCashReconciliation(req.auth.agencyId, { day: req.body?.day, countedAmount: req.body?.countedAmount, note: req.body?.note, actorUserId: req.auth.userId }) });
}

export async function postCashWithdrawal(req, res) {
  requireAdmin(req);
  const data = await withdrawCash(req.auth.agencyId, {
    day: req.body?.day,
    amount: req.body?.amount,
    reference: req.body?.reference,
    note: req.body?.note,
    idempotencyKey: req.body?.idempotencyKey,
    actorUserId: req.auth.userId,
  });
  res.status(data.reused ? 200 : 201).json({
    data,
  });
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

export async function getPaymentApprovalDetail(req, res) {
  requireAdmin(req);
  res.json({ data: await getPaymentApproval(req.auth.agencyId, req.params.id) });
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

// Manual override for a QuickBooks invoice refund that never completed —
// staff never finished it in QuickBooks, or the automatic matcher found
// more than one same-amount pending refund for the client and refused to
// guess which one it was (see quickbooksWebhookService.applyCaseInvoiceRefundReceipt).
// Cash refunds never reach this endpoint — they complete synchronously.
export async function getStuckInvoiceRefunds(req, res) {
  requireAdmin(req);
  const data = await listStuckInvoiceRefunds(req.auth.agencyId);
  res.json({ data });
}

// Detail drawers behind the Cash On Hand and QuickBooks Sync Failures KPI
// boxes — neither maps onto the payments table's row shape, so they get
// their own small read views instead of being forced through the bucket
// filter used by the other boxes.
export async function getCashLedgerActivity(req, res) {
  const data = await listCashLedgerActivity(req.auth.agencyId);
  res.json({ data });
}

export async function getQuickBooksSyncFailures(req, res) {
  const data = await listQuickBooksSyncFailures(req.auth.agencyId);
  res.json({ data });
}

export async function failInvoiceRefund(req, res) {
  requireAdmin(req);
  const data = await markInvoiceRefundFailed(req.auth.agencyId, {
    refundId: req.params.id,
    actorUserId: req.auth.userId,
    note: req.body?.note,
  });
  res.json({ data });
}
