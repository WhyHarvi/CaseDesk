import api from "../services/api";

export async function getClientManualBillingOptions(clientId) {
  const response = await api.get(`/clients/${clientId}/billing/manual-entry-options`, { cache: false });
  return response.data.data;
}

export async function createClientManualBillingEntry(clientId, values) {
  const response = await api.post(`/clients/${clientId}/billing/manual-entry`, values);
  return response.data.data;
}
