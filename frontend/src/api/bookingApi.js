import api from "../services/api";

export async function getBookingSettings() {
  const response = await api.get("/booking/settings");
  return response.data.data;
}

export async function updateBookingSettings(values) {
  const response = await api.put("/booking/settings", values);
  return response.data.data;
}

export async function regenerateBookingToken() {
  const response = await api.post("/booking/settings/regenerate-token");
  return response.data.data;
}

export async function createSessionType(values) {
  const response = await api.post("/booking/session-types", values);
  return response.data.data;
}

export async function updateSessionType(id, values) {
  const response = await api.patch(`/booking/session-types/${id}`, values);
  return response.data.data;
}

export async function deleteSessionType(id) {
  const response = await api.delete(`/booking/session-types/${id}`);
  return response.data;
}

export async function getAvailability({ from, to, durationMinutes, assignedToId }) {
  const params = new URLSearchParams({ from, to, durationMinutes: String(durationMinutes) });
  if (assignedToId) params.set("assignedToId", assignedToId);
  const response = await api.get(`/booking/availability?${params.toString()}`);
  return response.data.data;
}

export async function getCalendarAppointments({ from, to }) {
  const params = new URLSearchParams({ from, to });
  const response = await api.get(`/booking/calendar?${params.toString()}`);
  return response.data.data;
}

export async function createBookingAppointment(values) {
  const response = await api.post("/booking/appointments", values);
  return response.data.data;
}

export async function cancelBookingAppointment(id) {
  const response = await api.patch(`/booking/appointments/${id}/cancel`);
  return response.data.data;
}
