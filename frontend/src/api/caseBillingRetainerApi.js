import api from "../services/api";

export async function getCaseBillingRetainer(caseId) {
  const response = await api.get(`/case-billing-retainer/${caseId}`, { cache: false });
  return response.data.data;
}

export async function createCaseBillingRetainerDraft(caseId) {
  const response = await api.post(`/case-billing-retainer/${caseId}/draft`);
  return response.data.data;
}

export async function approveCaseBillingRetainer(caseId) {
  const response = await api.post(`/case-billing-retainer/${caseId}/approve`);
  return response.data.data;
}
