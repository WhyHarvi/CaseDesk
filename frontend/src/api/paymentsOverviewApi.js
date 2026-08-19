import api from "../services/api";

export async function getPaymentsOverview(params = {}) {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ""));
  const response = await api.get(`/payments-overview${query.size ? `?${query.toString()}` : ""}`, { cache: false });
  return response.data.data;
}

export async function getPaymentsOverviewSummary(month) {
  const response = await api.get("/payments-overview/summary", { params: month ? { month } : undefined, cache: false });
  return response.data.data;
}

export async function getConsultationRefundReview(refundReceiptId) {
  const response = await api.get(
    `/payments-overview/refunds/${encodeURIComponent(refundReceiptId)}`,
    { cache: false },
  );
  return response.data.data;
}

export async function getPaymentApprovals(params = {}) {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ""));
  const response = await api.get(`/payments-overview/approvals${query.size ? `?${query.toString()}` : ""}`, { cache: false });
  return response.data.data;
}

export async function getPaymentApproval(id) {
  const response = await api.get(`/payments-overview/approvals/${encodeURIComponent(id)}`, { cache: false });
  return response.data.data;
}

export async function approvePaymentApproval(id) {
  const response = await api.post(`/payments-overview/approvals/${encodeURIComponent(id)}/approve`);
  return response.data.data;
}

export async function rejectPaymentApproval(id, reason) {
  const response = await api.post(`/payments-overview/approvals/${encodeURIComponent(id)}/reject`, { reason });
  return response.data.data;
}

export async function getCashClosing(day) {
  const response = await api.get("/payments-overview/cash-closing", { params: { day }, cache: false });
  return response.data.data;
}

export async function closeCashLedger(values) {
  const response = await api.post("/payments-overview/cash-closing", values);
  return response.data.data;
}

export async function withdrawCashLedger(values) {
  const response = await api.post("/payments-overview/cash-withdrawals", values);
  return response.data.data;
}

export async function getStuckInvoiceRefunds() {
  const response = await api.get("/payments-overview/invoice-refunds/stuck", { cache: false });
  return response.data.data;
}

export async function failInvoiceRefund(id, note) {
  const response = await api.post(`/payments-overview/invoice-refunds/${encodeURIComponent(id)}/fail`, { note });
  return response.data.data;
}

export async function getCashLedgerActivity() {
  const response = await api.get("/payments-overview/cash-ledger-activity", { cache: false });
  return response.data.data;
}

export async function getQuickBooksSyncFailures() {
  const response = await api.get("/payments-overview/quickbooks-sync-failures", { cache: false });
  return response.data.data;
}
