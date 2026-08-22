import { Router } from "express";
import {
  getPortalAgreementView,
  getPortalAgreements,
  getPortalDocuments,
  getPortalOverview,
  getPortalAppointments,
  createPortalBookingSession,
  getPortalPayments,
  downloadPortalInvoicePdf,
  getPortalQuestionnaires,
  getPortalTimeline,
  savePortalQuestionnaireAnswers,
  servePortalAgreementFile,
  signPortalAgreement,
  submitPortalQuestionnaire,
  updatePortalProfile,
} from "../controllers/clientPortalController.js";
import { servePortalDocument, uploadPortalDocument } from "../controllers/portalController.js";
import { getPortalCaseFormRequests, signPortalCaseFormRequest, submitPortalCaseFormRequest } from "../controllers/clientPortalCaseFormController.js";
import { receiveDocumentFile } from "../middleware/documentUploadMiddleware.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { requireRole } from "../middleware/authorization.js";
import { asyncHandler } from "../utils/http.js";
import { requireClientPortalPermission as permit } from "../middleware/clientPortalPolicy.js";

const router = Router();
router.use(requireRole("client"));
router.get("/me", permit("general.access"), asyncHandler(getPortalOverview));
router.get("/documents", permit("documents.view"), asyncHandler(getPortalDocuments));
router.post("/documents/:id/upload", permit("documents.upload", { resource: "document" }), rateLimit({ windowMs: 60_000, max: 10 }), receiveDocumentFile, asyncHandler(uploadPortalDocument));
router.get("/documents/:id/file", permit("documents.download_finalized", { resource: "document" }), asyncHandler(servePortalDocument));
router.get("/payments", permit("payments.view_balance", { resource: "allCases" }), asyncHandler(getPortalPayments));
router.get("/appointments", permit("appointments.view", { resource: "allCases" }), asyncHandler(getPortalAppointments));
router.post("/appointments/booking-session", permit("appointments.book"), rateLimit({ windowMs: 60_000, max: 10 }), asyncHandler(createPortalBookingSession));
router.get("/payments/invoices/:invoiceId/pdf", permit("payments.download_invoices", { resource: "invoice" }), asyncHandler(downloadPortalInvoicePdf));
router.get("/timeline", permit("dashboard.view_activity_timeline", { resource: "allCases" }), asyncHandler(getPortalTimeline));
router.patch("/profile", permit("case_information.edit_contact", { resource: "allCases" }), rateLimit({ windowMs: 60_000, max: 10 }), asyncHandler(updatePortalProfile));
router.get("/questionnaires", permit("forms.view", { resource: "allCases" }), asyncHandler(getPortalQuestionnaires));
router.patch("/questionnaires/answers", permit("forms.edit", { resource: "allCases" }), rateLimit({ windowMs: 60_000, max: 30 }), asyncHandler(savePortalQuestionnaireAnswers));
router.post("/questionnaires/:assignmentId/submit", permit("forms.submit", { resource: "questionnaire" }), rateLimit({ windowMs: 60_000, max: 10 }), asyncHandler(submitPortalQuestionnaire));
router.get("/case-form-requests", permit("forms.view", { resource: "allCases" }), asyncHandler(getPortalCaseFormRequests));
router.post("/case-form-requests/:requestId/submit", permit("forms.submit", { resource: "caseFormRequest" }), rateLimit({ windowMs: 60_000, max: 10 }), asyncHandler(submitPortalCaseFormRequest));
router.post("/case-form-signature-requests/:requestId/sign", permit("forms.submit", { resource: "caseFormSignature" }), rateLimit({ windowMs: 60_000, max: 5 }), asyncHandler(signPortalCaseFormRequest));
router.get("/agreements", permit("forms.view", { resource: "allCases" }), asyncHandler(getPortalAgreements));
router.get("/agreements/:id/view", permit("forms.view", { resource: "agreement" }), asyncHandler(getPortalAgreementView));
router.get("/agreements/:id/file", permit("forms.download_submitted", { resource: "agreement" }), asyncHandler(servePortalAgreementFile));
router.post("/agreements/:id/sign", permit("forms.submit", { resource: "agreement" }), rateLimit({ windowMs: 60_000, max: 10 }), asyncHandler(signPortalAgreement));
export default router;
