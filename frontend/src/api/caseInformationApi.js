import api from "../services/api";

export async function getCaseInformationWorkspace(caseId) {
  const response = await api.get(`/cases/${caseId}/information-workspace`, { cache: false });
  return response.data.data;
}
