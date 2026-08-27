import api from "../services/api";

export async function getCaseEasyImportContacts(params) {
  const response = await api.get("/case-easy-import/contacts", { params, cache: false });
  return response.data;
}

export async function getCaseEasyImportContact(id) {
  const response = await api.get(`/case-easy-import/contacts/${id}`, { cache: false });
  return response.data.data;
}

export async function convertCaseEasyImportContact(id, payload) {
  const response = await api.post(`/case-easy-import/contacts/${id}/convert`, payload);
  return response.data.data;
}

export async function bulkConvertCaseEasyImportContacts(contactIds) {
  const response = await api.post("/case-easy-import/contacts/bulk-convert", { contactIds }, { timeout: 60_000 });
  return response.data.data;
}

export async function getUnlinkedCaseEasyImportCases(params) {
  const response = await api.get("/case-easy-import/unlinked-cases", {
    params,
    cache: false,
  });
  return response.data;
}

export async function getImportedCases(params) {
  const response = await api.get("/case-easy-import/imported-cases", {
    params,
    cache: false,
  });
  return response.data;
}

export async function getCaseEasyReportSummary() {
  const response = await api.get("/case-easy-import/reports/summary", {
    cache: false,
  });
  return response.data.data;
}

export async function getCaseEasyReportRows(params) {
  const response = await api.get("/case-easy-import/reports", {
    params,
    cache: false,
  });
  return response.data.data;
}

export async function getCaseEasyReportsForClient(clientId) {
  const response = await api.get(
    `/case-easy-import/clients/${clientId}/reports`,
    { cache: false },
  );
  return response.data.data;
}

export async function syncCaseEasyNotes() {
  const response = await api.post("/case-easy-import/notes/sync", {}, { timeout: 60_000 });
  return response.data.data;
}

export async function getCaseEasyReportsForCase(caseId) {
  const response = await api.get(
    `/case-easy-import/cases/${caseId}/reports`,
    { cache: false },
  );
  return response.data.data;
}
