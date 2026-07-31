import { Router } from "express";
import {
  archiveCase,
  createCase,
  closeCase,
  createCaseDocumentChecklist,
  getCaseById,
  getCasePermissions,
  listCases,
  listCaseTypes,
  restoreCase,
  softDeleteCase,
  unarchiveCase,
  updateCaseDocumentAssignment,
  updateCase,
  updateCasePermissions,
} from "../controllers/caseController.js";
import {
  getCaseAssessment,
  saveCaseAssessment,
} from "../controllers/caseAssessmentController.js";
import { getCaseInformationWorkspace, getCaseTypeMatch } from "../controllers/caseInformationWorkspaceController.js";
import { patchCaseInformationSection, putCaseInformationSectionState } from "../controllers/caseInformationMutationController.js";
import { reviewQuestionnaireAssignment } from "../controllers/questionnaireReviewController.js";
import {
  applyCaseWorkflowTemplate,
  createCaseTask,
  cancelCaseTask,
  getCaseWorkflow,
  saveCaseWorkflow,
  updateCaseWorkflowStep,
} from "../controllers/caseWorkflowController.js";
import { asyncHandler } from "../utils/http.js";
import {
  createCaseApplicant,
  listCaseApplicants,
  removeCaseApplicant,
  updateCaseApplicant,
} from "../controllers/caseApplicantController.js";
import { requireCaseAccess, requireRole } from "../middleware/authorization.js";
import { createCashPayment, createInvoice, createManualPayment, downloadInvoicePdf, listInvoices } from "../controllers/caseInvoiceController.js";
import { createSchedule, getPaymentSummaries, getPaymentSummary, getSchedule, updateSchedule, voidInstallmentInvoice, voidSchedule } from "../controllers/paymentScheduleController.js";
import rateLimit from "../middleware/rateLimit.js";

const router = Router();

router.get("/", asyncHandler(listCases));
router.get("/case-types", asyncHandler(listCaseTypes));
router.get("/payment-summaries", asyncHandler(getPaymentSummaries));
router.post("/", asyncHandler(createCase));
router.use("/:id", requireCaseAccess());
router.get("/:id/permissions", requireRole("admin"), asyncHandler(getCasePermissions));
router.put("/:id/permissions", requireRole("admin"), asyncHandler(updateCasePermissions));
router.get("/:id/assessment", asyncHandler(getCaseAssessment));
router.get("/:id/information-workspace", asyncHandler(getCaseInformationWorkspace));
router.get("/:id/case-type-match", asyncHandler(getCaseTypeMatch));
router.patch("/:id/information-sections/:sectionKey", requireRole("admin", "consultant"), rateLimit({ windowMs: 60_000, max: 60 }), asyncHandler(patchCaseInformationSection));
router.put("/:id/information-sections/:sectionKey/state", requireRole("admin", "consultant"), rateLimit({ windowMs: 60_000, max: 60 }), asyncHandler(putCaseInformationSectionState));
router.post("/:id/questionnaire-assignments/:assignmentId/review", requireRole("admin", "consultant"), rateLimit({ windowMs: 60_000, max: 30 }), asyncHandler(reviewQuestionnaireAssignment));
router.get("/:id/applicants", asyncHandler(listCaseApplicants));
router.post("/:id/applicants", asyncHandler(createCaseApplicant));
router.patch("/:id/applicants/:applicantId", asyncHandler(updateCaseApplicant));
router.delete("/:id/applicants/:applicantId", asyncHandler(removeCaseApplicant));
router.patch("/:id/assessment", asyncHandler(saveCaseAssessment));
router.get("/:id/workflow", asyncHandler(getCaseWorkflow));
router.post("/:id/tasks", asyncHandler(createCaseTask));
router.patch("/:id/tasks/:taskId/cancel", asyncHandler(cancelCaseTask));
router.post("/:id/document-checklist", asyncHandler(createCaseDocumentChecklist));
router.patch("/:id/document-assignment", asyncHandler(updateCaseDocumentAssignment));
router.post("/:id/workflow/apply-template", asyncHandler(applyCaseWorkflowTemplate));
router.patch("/:id/workflow", asyncHandler(saveCaseWorkflow));
router.patch("/:id/workflow/:stepId", asyncHandler(updateCaseWorkflowStep));
router.get("/:id", asyncHandler(getCaseById));
router.patch("/:id", asyncHandler(updateCase));
router.patch("/:id/close", asyncHandler(closeCase));
router.patch("/:id/archive", asyncHandler(archiveCase));
router.patch("/:id/unarchive", asyncHandler(unarchiveCase));
router.delete("/:id", asyncHandler(softDeleteCase));
router.patch("/:id/restore", asyncHandler(restoreCase));
router.get("/:id/invoices", asyncHandler(listInvoices));
router.post("/:id/invoices", requireRole("admin", "consultant"), rateLimit({ windowMs: 60_000, max: 20 }), asyncHandler(createInvoice));
router.post("/:id/invoices/:invoiceId/cash-payment", requireRole("admin", "consultant"), rateLimit({ windowMs: 60_000, max: 20 }), asyncHandler(createCashPayment));
router.post("/:id/invoices/:invoiceId/manual-payment", requireRole("admin", "consultant"), rateLimit({ windowMs: 60_000, max: 20 }), asyncHandler(createManualPayment));
router.get("/:id/invoices/:invoiceId/pdf", asyncHandler(downloadInvoicePdf));
router.get("/:id/payment-summary", asyncHandler(getPaymentSummary));
router.get("/:id/payment-schedule", asyncHandler(getSchedule));
router.post("/:id/payment-schedule", requireRole("admin", "consultant"), rateLimit({ windowMs: 60_000, max: 10 }), asyncHandler(createSchedule));
router.patch("/:id/payment-schedule", requireRole("admin", "consultant"), rateLimit({ windowMs: 60_000, max: 20 }), asyncHandler(updateSchedule));
router.post("/:id/payment-schedule/void", requireRole("admin"), rateLimit({ windowMs: 60_000, max: 10 }), asyncHandler(voidSchedule));
router.post("/:id/payment-schedule/installments/:installmentId/void", requireRole("admin"), rateLimit({ windowMs: 60_000, max: 10 }), asyncHandler(voidInstallmentInvoice));

export default router;
