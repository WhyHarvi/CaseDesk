import api from "../services/api";

export async function getCaseInformationWorkspace(caseId) {
  const response = await api.get(`/cases/${caseId}/information-workspace`, { cache: false });
  return response.data.data;
}

export async function setCaseInformationSectionEnabled(caseId, sectionKey, enabled) {
  const response = await api.put(`/cases/${caseId}/information-sections/${sectionKey}/state`, { enabled });
  return response.data.data;
}
