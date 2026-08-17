import api from "../services/api";

export async function getCaseInvoices(caseId) {
  const response = await api.get(`/cases/${caseId}/invoices`, { cache: false });
  return response.data.data;
}

export async function createCaseInvoice(caseId, values) {
  const response = await api.post(`/cases/${caseId}/invoices`, values);
  return response.data.data;
}

export async function recordCaseInvoiceCashPayment(caseId, invoiceId, values) {
  const response = await api.post(`/cases/${caseId}/invoices/${invoiceId}/cash-payment`, values);
  return response.data.data;
}

export async function recordCaseInvoiceManualPayment(caseId, invoiceId, values) {
  const response = await api.post(`/cases/${caseId}/invoices/${invoiceId}/manual-payment`, values);
  return response.data.data;
}

export async function requestCaseInvoiceRefund(caseId, invoiceId, values) {
  const response = await api.post(`/cases/${caseId}/invoices/${invoiceId}/refunds`, values);
  return response.data.data;
}

export async function voidCaseInvoice(caseId, invoiceId, reason) {
  const response = await api.post(`/cases/${caseId}/invoices/${invoiceId}/void`, { reason });
  return response.data.data;
}

export async function downloadCaseInvoicePdf(caseId, invoiceId, filename) {
  const response = await api.get(`/cases/${caseId}/invoices/${invoiceId}/pdf`, { responseType: "blob", timeout: 30000 });
  const url = URL.createObjectURL(response.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename || "invoice.pdf";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
