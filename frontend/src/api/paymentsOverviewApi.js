import api from "../services/api";

export async function getPaymentsOverview(params = {}) {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ""));
  const response = await api.get(`/payments-overview${query.size ? `?${query.toString()}` : ""}`, { cache: false });
  return response.data.data;
}

export async function getPaymentsOverviewSummary() {
  const response = await api.get("/payments-overview/summary", { cache: false });
  return response.data.data;
}
