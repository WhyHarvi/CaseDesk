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
