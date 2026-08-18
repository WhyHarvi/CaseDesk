import api from "../services/api";

export async function getBookingSettings() {
  const response = await api.get("/booking/settings");
  return response.data.data;
}

export async function updateBookingSettings(values) {
  const response = await api.put("/booking/settings", values);
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

export async function updateSchedulingStaff(userId, values) {
  const response = await api.patch(`/booking/staff/${userId}`, values);
  return response.data.data;
}

export async function getFreeConsultationEligibility({ clientId, guestEmail, sessionTypeId } = {}) {
  const params = new URLSearchParams();
  if (clientId) params.set("clientId", clientId);
  if (guestEmail) params.set("guestEmail", guestEmail);
  if (sessionTypeId) params.set("sessionTypeId", sessionTypeId);
  const response = await api.get(`/booking/free-consultation-eligibility?${params.toString()}`);
  return response.data.data;
}

export async function lookupBookingClients({ search } = {}) {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  const response = await api.get(`/booking/client-lookup${params.size ? `?${params.toString()}` : ""}`);
  return response.data.data;
}

export async function getSchedulingAnalytics(params = {}) {
  const query = new URLSearchParams(params);
  const response = await api.get(`/booking/analytics${query.size ? `?${query.toString()}` : ""}`);
  return response.data.data;
}

export async function getAppointmentRegistry(params = {}) {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ""));
  const response = await api.get(`/booking/appointments/registry?${query.toString()}`);
  return { data: response.data.data, meta: response.data.meta };
}

export async function getAppointmentRegistryDetail(id) {
  const response = await api.get(`/booking/appointments/${id}/detail`);
  return response.data.data;
}

export async function updateAppointmentProfileContext(id, values) {
  const response = await api.patch(`/appointments/${id}/profile`, values);
  return response.data.data;
}

export async function createAppointmentNote(id, content) {
  const response = await api.post(`/appointments/${id}/notes`, { content });
  return response.data.data;
}

export async function updateAppointmentNote(id, content) {
  const response = await api.patch(`/notes/${id}`, { content });
  return response.data.data;
}

export async function archiveAppointmentNote(id) {
  await api.delete(`/notes/${id}`);
}

export async function createAppointmentFollowUp(id, values) {
  const response = await api.post(`/appointments/${id}/follow-ups`, values);
  return response.data.data;
}

export async function getSchedulingBlocks(params = {}) {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value));
  const response = await api.get(`/booking/blocks${query.size ? `?${query.toString()}` : ""}`);
  return response.data.data;
}

export async function createSchedulingBlock(values) {
  const response = await api.post("/booking/blocks", values);
  return response.data.data;
}

export async function deleteSchedulingBlock(id) {
  const response = await api.delete(`/booking/blocks/${id}`);
  return response.data.data;
}

export async function getBookingWaitlist(status = "Waiting") {
  const response = await api.get(`/booking/waitlist?status=${encodeURIComponent(status)}`);
  return response.data.data;
}

export async function updateBookingWaitlistEntry(id, status) {
  const response = await api.patch(`/booking/waitlist/${id}`, { status });
  return response.data.data;
}

export async function previewBookingEmail(kind, messageTemplates) {
  const response = await api.post("/booking/settings/email-preview", { kind, messageTemplates });
  return response.data.data;
}

export async function sendBookingTestEmail(kind, messageTemplates) {
  const response = await api.post("/booking/settings/test-email", { kind, messageTemplates });
  return response.data.data;
}

export async function getZoomStatus() {
  const response = await api.get("/zoom/status", { cache: false });
  return response.data.data;
}

export async function startZoomConnect() {
  const response = await api.post("/zoom/connect");
  return response.data.data;
}

export async function updateZoomMappings(mappings) {
  const response = await api.put("/zoom/mappings", { mappings });
  return response.data.data;
}

export async function disconnectZoom() {
  const response = await api.post("/zoom/disconnect");
  return response.data.data;
}

export async function convertAppointmentToClient(id) {
  const response = await api.post(`/booking/appointments/${id}/convert-client`);
  return response.data.data;
}

export async function updateBookingAppointmentStatus(id, status, reason) {
  const response = await api.patch(`/booking/appointments/${id}/status`, { status, reason });
  return response.data.data;
}

export async function getAvailability({ from, to, durationMinutes, assignedToId, sessionTypeId, meetingMode, locationId }) {
  const params = new URLSearchParams({ from, to, durationMinutes: String(durationMinutes) });
  if (assignedToId) params.set("assignedToId", assignedToId);
  if (sessionTypeId) params.set("sessionTypeId", sessionTypeId);
  if (meetingMode) params.set("meetingMode", meetingMode);
  if (locationId) params.set("locationId", locationId);
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

export async function shortenAppointmentSubject(subject) {
  const response = await api.post("/booking/appointments/subject/shorten", { subject });
  return response.data.data.subject;
}

export async function getBookingPaymentHoldStatus(id) {
  const response = await api.get(`/booking/payment-holds/${id}`, { cache: false });
  return response.data.data;
}

export async function resendBookingPaymentHoldRequest(id, values = {}) {
  const response = await api.post(`/booking/payment-holds/${id}/resend`, values);
  return response.data.data;
}

export async function cancelBookingPaymentHoldRequest(id) {
  const response = await api.post(`/booking/payment-holds/${id}/cancel`);
  return response.data.data;
}

export async function createWalkInPayNowLink(id) {
  const response = await api.post(`/booking/appointments/${id}/pay-now-link`);
  return response.data.data;
}

export async function recordWalkInManualPayment(id, { method, transactionReference, paymentDate, note }) {
  const response = await api.post(`/booking/appointments/${id}/manual-payment`, {
    method,
    transactionReference,
    paymentDate,
    note,
  });
  return response.data.data;
}

export async function updatePaidAppointmentPaymentDetails(id, values) {
  const response = await api.patch(`/booking/appointments/${id}/payment-details`, values);
  return response.data.data;
}

export async function cancelBookingAppointment(id, options = {}) {
  const response = await api.patch(`/booking/appointments/${id}/cancel`, options);
  return response.data.data;
}

export async function getAppointmentRefundEstimate(id) {
  const response = await api.get(`/booking/appointments/${id}/refund-estimate`);
  return response.data.data;
}

export async function rescheduleBookingAppointment(id, startsAt, options = {}) {
  const response = await api.patch(`/booking/appointments/${id}/reschedule`, { startsAt, ...options });
  return response.data.data;
}

export async function getPublicBookingInfo(token, offerToken) {
  const response = await api.get(`/public/booking/${token}${offerToken ? `?offer=${encodeURIComponent(offerToken)}` : ""}`);
  return response.data.data;
}

export function getPublicBookingAvatarUrl(token) {
  const base = String(api.defaults.baseURL || "").replace(/\/$/, "");
  return `${base}/public/booking/${encodeURIComponent(token)}/avatar`;
}

export async function getPublicAvailability(token, { sessionTypeId, consultantId, from, to, offerToken, locationId, meetingMode }) {
  const params = new URLSearchParams({ sessionTypeId, from, to });
  if (consultantId) params.set("consultantId", consultantId);
  if (offerToken) params.set("offerToken", offerToken);
  if (locationId) params.set("locationId", locationId);
  if (meetingMode) params.set("meetingMode", meetingMode);
  const response = await api.get(`/public/booking/${token}/availability?${params.toString()}`);
  return response.data.data;
}

export async function createPublicBooking(token, values) {
  const response = await api.post(`/public/booking/${token}/appointments`, values);
  return response.data.data;
}

export async function createPublicBookingPaymentHold(token, values) {
  const response = await api.post(`/public/booking/${token}/payment-hold`, values);
  return response.data.data;
}

export async function getPublicBookingPaymentHoldStatus(token, claimToken) {
  const response = await api.get(`/public/booking/${token}/payment-hold/${claimToken}`, { cache: false });
  return response.data.data;
}

export async function joinPublicBookingWaitlist(token, values) {
  const response = await api.post(`/public/booking/${token}/waitlist`, values);
  return response.data.data;
}

export async function requestPublicBookingVerification(token, email) {
  const response = await api.post(`/public/booking/${token}/verification/request`, { email });
  return response.data.data;
}

export async function verifyPublicBookingEmail(token, verificationId, code) {
  const response = await api.post(`/public/booking/${token}/verification/verify`, { verificationId, code });
  return response.data.data;
}

export async function getManagedBooking(manageToken) {
  const response = await api.get(`/public/booking/manage/${manageToken}`);
  return response.data.data;
}

export async function getManagedAvailability(manageToken, { from, to, meetingMode, locationId }) {
  const params = new URLSearchParams({ from, to });
  if (meetingMode) params.set("meetingMode", meetingMode);
  if (locationId) params.set("locationId", locationId);
  const response = await api.get(`/public/booking/manage/${manageToken}/availability?${params.toString()}`);
  return response.data.data;
}

export async function cancelManagedBooking(manageToken, reason, scope = "single") {
  const response = await api.post(`/public/booking/manage/${manageToken}/cancel`, { reason, scope });
  return response.data.data;
}

export async function rescheduleManagedBooking(manageToken, values) {
  const response = await api.post(`/public/booking/manage/${manageToken}/reschedule`, values);
  return response.data.data;
}

export async function confirmManagedBooking(manageToken) {
  const response = await api.post(`/public/booking/manage/${manageToken}/confirm`);
  return response.data.data;
}

export async function completeManagedPreparation(manageToken) {
  const response = await api.post(`/public/booking/manage/${manageToken}/preparation-complete`);
  return response.data.data;
}

export async function getManagedRetainer(manageToken) {
  const response = await api.get(`/public/booking/manage/${manageToken}/retainer`);
  return response.data.data;
}

export async function signManagedRetainer(manageToken, { fullName, consent, signatureMethod, signatureImage }) {
  const response = await api.post(`/public/booking/manage/${manageToken}/retainer/sign`, { fullName, consent, signatureMethod, signatureImage });
  return response.data;
}
