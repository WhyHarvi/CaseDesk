import { Router } from "express";
import {
  getPortalAgreementView,
  getPortalAgreements,
  getPortalDocuments,
  getPortalOverview,
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
import { receiveDocumentFile } from "../middleware/documentUploadMiddleware.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { requireRole } from "../middleware/authorization.js";
import { asyncHandler } from "../utils/http.js";

const router = Router();
router.use(requireRole("client"));
router.get("/me", asyncHandler(getPortalOverview));
router.get("/documents", asyncHandler(getPortalDocuments));
router.post("/documents/:id/upload", rateLimit({ windowMs: 60_000, max: 10 }), receiveDocumentFile, asyncHandler(uploadPortalDocument));
router.get("/documents/:id/file", asyncHandler(servePortalDocument));
router.get("/payments", asyncHandler(getPortalPayments));
router.get("/payments/invoices/:invoiceId/pdf", asyncHandler(downloadPortalInvoicePdf));
router.get("/timeline", asyncHandler(getPortalTimeline));
router.patch("/profile", rateLimit({ windowMs: 60_000, max: 10 }), asyncHandler(updatePortalProfile));
router.get("/questionnaires", asyncHandler(getPortalQuestionnaires));
router.patch("/questionnaires/answers", rateLimit({ windowMs: 60_000, max: 30 }), asyncHandler(savePortalQuestionnaireAnswers));
router.post("/questionnaires/:assignmentId/submit", rateLimit({ windowMs: 60_000, max: 10 }), asyncHandler(submitPortalQuestionnaire));
router.get("/agreements", asyncHandler(getPortalAgreements));
router.get("/agreements/:id/view", asyncHandler(getPortalAgreementView));
router.get("/agreements/:id/file", asyncHandler(servePortalAgreementFile));
router.post("/agreements/:id/sign", rateLimit({ windowMs: 60_000, max: 10 }), asyncHandler(signPortalAgreement));
export default router;
