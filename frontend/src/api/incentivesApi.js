import api from "../services/api";

export async function getIncentiveSummary({ userId } = {}) {
  const response = await api.get("/incentives/summary", { params: { userId }, cache: false });
  return response.data.data;
}

export async function getIncentiveTeamSummary() {
  const response = await api.get("/incentives/summary/team", { cache: false });
  return response.data.data;
}

export async function getIncentiveLedger({ userId, caseId, dateFrom, dateTo, page, pageSize } = {}) {
  const response = await api.get("/incentives/ledger", { params: { userId, caseId, dateFrom, dateTo, page, pageSize }, cache: false });
  return response.data;
}

export async function getIncentivePipeline({ userId } = {}) {
  const response = await api.get("/incentives/pipeline", { params: { userId }, cache: false });
  return response.data.data;
}
