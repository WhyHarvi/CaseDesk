import api from "../services/api";

export function getPortalOverview() {
  return api.get("/client-portal/me").then((response) => response.data.data);
}

export function getPortalDocuments() {
  return api.get("/client-portal/documents").then((response) => response.data.data);
}

export function uploadPortalDocument(documentId, file) {
  const data = new FormData();
  data.append("file", file);
  return api
    .post(`/client-portal/documents/${documentId}/upload`, data, { timeout: 60_000 })
    .then((response) => response.data.data);
}

export function portalDocumentFileUrl(documentId, { download = false } = {}) {
  const base = api.defaults.baseURL?.replace(/\/$/, "") || "/api";
  return `${base}/client-portal/documents/${documentId}/file${download ? "?download=1" : ""}`;
}

export function getPortalPayments() {
  return api.get("/client-portal/payments").then((response) => response.data.data);
}

export function getPortalAppointments() {
  return api.get("/client-portal/appointments").then((response) => response.data.data);
}

export function createPortalBookingSession() {
  return api.post("/client-portal/appointments/booking-session").then((response) => response.data.data);
}

export async function downloadPortalInvoicePdf(invoiceId, filename) {
  const response = await api.get(`/client-portal/payments/invoices/${invoiceId}/pdf`, { responseType: "blob", timeout: 30000 });
  const url = URL.createObjectURL(response.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename || "invoice.pdf";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function getPortalTimeline() {
  return api.get("/client-portal/timeline").then((response) => response.data.data);
}

export function updatePortalProfile(changes) {
  return api.patch("/client-portal/profile", changes).then((response) => response.data);
}

export function getPortalQuestionnaires() {
  return api.get("/client-portal/questionnaires").then((response) => response.data.data);
}

export function savePortalQuestionnaireAnswers({ type, sectionId, values }) {
  return api.patch("/client-portal/questionnaires/answers", { type, sectionId, values }).then((response) => response.data);
}

export function submitPortalQuestionnaire(assignmentId) {
  return api.post(`/client-portal/questionnaires/${assignmentId}/submit`).then((response) => response.data);
}

export function getPortalCaseFormRequests() {
  return api.get("/client-portal/case-form-requests").then((response) => response.data.data);
}

export function submitPortalCaseFormRequest(requestId, answers) {
  return api.post(`/client-portal/case-form-requests/${requestId}/submit`, { answers }).then((response) => response.data);
}

export function signPortalCaseFormRequest(requestId, { consent, signatureImage, signatureStrokes }) {
  return api.post(`/client-portal/case-form-signature-requests/${requestId}/sign`, { consent, signatureImage, signatureStrokes }).then((response) => response.data);
}

export function getPortalAgreements() {
  return api.get("/client-portal/agreements").then((response) => response.data.data);
}

export function getPortalAgreementView(agreementId) {
  return api.get(`/client-portal/agreements/${agreementId}/view`).then((response) => response.data.data);
}

export function downloadPortalAgreementFile(agreementId, filename = "agreement") {
  return api
    .get(`/client-portal/agreements/${agreementId}/file?download=1`, { responseType: "blob", timeout: 60_000 })
    .then((response) => {
      const url = URL.createObjectURL(response.data);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    });
}

export function signPortalAgreement(agreementId, { fullName, consent, signatureMethod, signatureImage }) {
  return api.post(`/client-portal/agreements/${agreementId}/sign`, {
    fullName,
    consent,
    signatureMethod,
    signatureImage,
  }).then((response) => response.data);
}

export function getPortalChat(caseId = "") {
  return api
    .get(`/portal/messages${caseId ? `?caseId=${encodeURIComponent(caseId)}` : ""}`)
    .then((response) => response.data.data);
}

export function getPortalChatRealtimeConfig(caseId) {
  return api
    .get(`/portal/messages/realtime${caseId ? `?caseId=${encodeURIComponent(caseId)}` : ""}`)
    .then((response) => response.data.data);
}

export function sendPortalChatMessage({ caseId, bodyText, clientMessageId, hasAttachment }) {
  return api
    .post("/portal/messages", { caseId, bodyText, clientMessageId, hasAttachment }, { timeout: 20_000 })
    .then((response) => response.data.data);
}

export function uploadPortalChatAttachment(messageId, file, { onUploadProgress } = {}) {
  const data = new FormData();
  data.append("file", file);
  return api
    .post(`/portal/messages/${messageId}/attachments`, data, { timeout: 60_000, onUploadProgress })
    .then((response) => response.data.data);
}

export function fetchPortalChatAttachmentBlob(messageId, attachmentId) {
  return api
    .get(`/portal/messages/${messageId}/attachments/${attachmentId}/file`, { responseType: "blob" })
    .then((response) => response.data);
}

export function markPortalChatRead(caseId) {
  return api.post("/portal/messages/read", { caseId }).catch(() => {});
}

export function portalErrorMessage(reason, fallback) {
  return reason?.response?.data?.message || fallback;
}
