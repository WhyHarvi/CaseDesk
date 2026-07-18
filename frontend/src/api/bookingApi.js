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

export async function getCalendarAppointments({ from, to, fresh = false }) {
  const params = new URLSearchParams({ from, to });
  const response = await (fresh ? api.getFresh : api.get)(`/booking/calendar?${params.toString()}`);
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

export async function rescheduleBookingAppointment(id, startsAt) {
  const response = await api.patch(`/booking/appointments/${id}/reschedule`, { startsAt });
  return response.data.data;
}

export async function getPublicBookingInfo(token) {
  const response = await api.get(`/public/booking/${token}`);
  return response.data.data;
}

export async function getPublicAvailability(token, { sessionTypeId, from, to }) {
  const params = new URLSearchParams({ sessionTypeId, from, to });
  const response = await api.get(`/public/booking/${token}/availability?${params.toString()}`);
  return response.data.data;
}

export async function createPublicBooking(token, values) {
  const response = await api.post(`/public/booking/${token}/appointments`, values);
  return response.data.data;
}

export async function getManagedBooking(manageToken) {
  const response = await api.get(`/public/booking/manage/${manageToken}`);
  return response.data.data;
}

export async function getManagedAvailability(manageToken, { from, to }) {
  const params = new URLSearchParams({ from, to });
  const response = await api.get(`/public/booking/manage/${manageToken}/availability?${params.toString()}`);
  return response.data.data;
}

export async function cancelManagedBooking(manageToken) {
  const response = await api.post(`/public/booking/manage/${manageToken}/cancel`);
  return response.data.data;
}

export async function rescheduleManagedBooking(manageToken, values) {
  const response = await api.post(`/public/booking/manage/${manageToken}/reschedule`, values);
  return response.data.data;
}
