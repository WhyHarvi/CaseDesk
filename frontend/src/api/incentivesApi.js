import api from "../services/api";

// Incentive figures are expensive to compute and don't need to be
// second-fresh, so these deliberately go through the normal cached GET path
// (see queryClient.js's staleTimeFor) instead of cache: false — the page
// shows the last-known numbers immediately, then silently revalidates in
// the background once they're stale, rather than blocking on a fresh
// computation (and a fresh round of Supabase reads) on every visit.
export async function getIncentiveSummary({ userId } = {}) {
  const response = await api.get("/incentives/summary", { params: { userId } });
  return response.data.data;
}

export async function getIncentiveTeamSummary() {
  const response = await api.get("/incentives/summary/team");
  return response.data.data;
}

export async function getIncentiveLedger({ userId, caseId, dateFrom, dateTo, page, pageSize, approvalStatus } = {}) {
  const response = await api.get("/incentives/ledger", { params: { userId, caseId, dateFrom, dateTo, page, pageSize, approvalStatus } });
  return response.data;
}

export async function getIncentivePipeline({ userId } = {}) {
  const response = await api.get("/incentives/pipeline", { params: { userId } });
  return response.data.data;
}

export async function getActiveTimelines({ userId } = {}) {
  const response = await api.get("/incentives/timelines", { params: { userId } });
  return response.data.data;
}
