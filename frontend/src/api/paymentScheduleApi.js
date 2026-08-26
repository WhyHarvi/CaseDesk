import api from "../services/api";

export async function getPaymentCommunicationSettings() {
  const response = await api.get("/payment-schedules/settings", { cache: false });
  return response.data.data;
}

export async function updatePaymentCommunicationSettings(values) {
  const response = await api.patch("/payment-schedules/settings", values);
  return response.data.data;
}

export async function getScheduleTemplates(caseType) {
  const params = caseType ? `?caseType=${encodeURIComponent(caseType)}` : "";
  const response = await api.get(`/payment-schedules/templates${params}`, { cache: false });
  return response.data.data;
}

export async function createScheduleTemplate(values) {
  const response = await api.post("/payment-schedules/templates", values);
  return response.data.data;
}

export async function updateScheduleTemplate(templateId, values) {
  const response = await api.patch(`/payment-schedules/templates/${templateId}`, values);
  return response.data.data;
}

export async function deleteScheduleTemplate(templateId) {
  const response = await api.delete(`/payment-schedules/templates/${templateId}`);
  return response.data;
}

export async function getCaseSchedule(caseId) {
  const response = await api.get(`/cases/${caseId}/payment-schedule`, { cache: false });
  return response.data.data;
}

export async function createCaseSchedule(caseId, values) {
  const response = await api.post(`/cases/${caseId}/payment-schedule`, values);
  return response.data.data;
}

export async function updateCaseSchedule(caseId, installments, discountAmount) {
  const response = await api.patch(`/cases/${caseId}/payment-schedule`, { installments, discountAmount });
  return response.data.data;
}

export async function voidCaseSchedule(caseId, reason) {
  const response = await api.post(`/cases/${caseId}/payment-schedule/void`, { reason });
  return response.data.data;
}

export async function voidInstallmentInvoice(caseId, installmentId, reason) {
  const response = await api.post(`/cases/${caseId}/payment-schedule/installments/${installmentId}/void`, { reason });
  return response.data.data;
}

export async function retryInstallmentInvoice(caseId, installmentId) {
  const response = await api.post(`/cases/${caseId}/payment-schedule/installments/${installmentId}/retry`);
  return response.data.data;
}
