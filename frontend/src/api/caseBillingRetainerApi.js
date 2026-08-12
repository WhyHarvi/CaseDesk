import api from "../services/api";

export async function getCaseBillingRetainer(caseId) {
  const response = await api.get(`/case-billing-retainer/${caseId}`, { cache: false });
  return response.data.data;
}

export async function createCaseBillingRetainerDraft(caseId, schedule) {
  const response = await api.post(`/case-billing-retainer/${caseId}/draft`, schedule || undefined);
  return response.data.data;
}

export async function previewCaseBillingRetainer(caseId, schedule) {
  const response = await api.post(
    `/case-billing-retainer/${caseId}/preview`,
    schedule || undefined,
  );
  return response.data.data;
}

export async function syncCaseBillingRetainerWithSchedule(caseId) {
  const response = await api.post(`/case-billing-retainer/${caseId}/sync-schedule`);
  return response.data.data;
}

export async function resetCaseBillingRetainer(caseId, documentId) {
  const response = await api.post(`/case-billing-retainer/${caseId}/reset`, {
    documentId,
  });
  return response.data.data;
}

export async function approveCaseBillingRetainer(caseId) {
  const response = await api.post(`/case-billing-retainer/${caseId}/approve`);
  return response.data.data;
}
