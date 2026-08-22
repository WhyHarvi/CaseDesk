import api from "../services/api";

export async function getIncentivePlans({ includeInactive = true } = {}) {
  const response = await api.get("/incentive-plans", { params: { includeInactive }, cache: false });
  return response.data.data;
}

export async function createIncentivePlan(values) {
  const response = await api.post("/incentive-plans", values);
  return response.data.data;
}

export async function updateIncentivePlan(id, values) {
  const response = await api.patch(`/incentive-plans/${id}`, values);
  return response.data.data;
}

export async function activateIncentivePlan(id) {
  const response = await api.post(`/incentive-plans/${id}/activate`);
  return response.data.data;
}

export async function deactivateIncentivePlan(id) {
  const response = await api.post(`/incentive-plans/${id}/deactivate`);
  return response.data.data;
}

export async function deleteIncentivePlan(id) {
  await api.delete(`/incentive-plans/${id}`);
}

export async function previewLegacyInvoicePlanApplication(id) {
  const response = await api.get(`/incentive-plans/${id}/legacy-invoices`, { cache: false });
  return response.data.data;
}

export async function applyPlanToLegacyInvoices(id) {
  const response = await api.post(`/incentive-plans/${id}/legacy-invoices/apply`);
  return response.data.data;
}

export async function previewRetroactiveIncentiveApprovals(id) {
  const response = await api.get(`/incentive-plans/${id}/retroactive-approvals`, { cache: false });
  return response.data.data;
}

export async function approveRetroactiveIncentiveApprovals(id) {
  const response = await api.post(`/incentive-plans/${id}/retroactive-approvals/approve`);
  return response.data.data;
}

export async function previewIncentivePlanRecalculation(id) {
  const response = await api.get(`/incentive-plans/${id}/recalculation`, { cache: false });
  return response.data.data;
}

export async function applyIncentivePlanRecalculation(id) {
  const response = await api.post(`/incentive-plans/${id}/recalculation/apply`);
  return response.data.data;
}
