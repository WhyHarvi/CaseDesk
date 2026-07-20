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

export function sendPortalChatMessage({ caseId, bodyText, clientMessageId }) {
  return api
    .post("/portal/messages", { caseId, bodyText, clientMessageId }, { timeout: 20_000 })
    .then((response) => response.data.data);
}

export function portalErrorMessage(reason, fallback) {
  return reason?.response?.data?.message || fallback;
}
