import api from "../services/api";

export async function getCaseRoles({ includeInactive = false } = {}) {
  const response = await api.get("/case-roles", { params: { includeInactive }, cache: false });
  return response.data.data;
}

export async function createCaseRole(values) {
  const response = await api.post("/case-roles", values);
  return response.data.data;
}

export async function updateCaseRole(id, values) {
  const response = await api.patch(`/case-roles/${id}`, values);
  return response.data.data;
}

export async function deleteCaseRole(id) {
  await api.delete(`/case-roles/${id}`);
}

export async function getCaseRoleAssignments(caseId) {
  const response = await api.get(`/cases/${caseId}/roles`, { cache: false });
  return response.data.data;
}

export async function replaceCaseRoleAssignments(caseId, assignments) {
  const response = await api.put(`/cases/${caseId}/roles`, { assignments });
  return response.data.data;
}

export async function deleteCaseRoleAssignment(caseId, assignmentId) {
  await api.delete(`/cases/${caseId}/roles/${assignmentId}`);
}
