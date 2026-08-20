import api from "../services/api";

export async function getStaffPreConsultationIntake(appointmentId) {
  const response = await api.get(`/booking/appointments/${appointmentId}/pre-consultation`, { cache: false });
  return response.data.data;
}

export async function sendStaffPreConsultationIntake(appointmentId) {
  const response = await api.post(`/booking/appointments/${appointmentId}/pre-consultation/send`);
  return response.data.data;
}

export async function saveStaffPreConsultationIntake(appointmentId, values) {
  const response = await api.post(`/booking/appointments/${appointmentId}/pre-consultation/manual`, values);
  return response.data.data;
}
