import { Router } from "express";
import {
  archiveCase,
  closeCase,
  createCaseDocumentChecklist,
  getCaseById,
  listCases,
  listCaseTypes,
  listStudyIntakes,
  restoreCase,
  softDeleteCase,
  unarchiveCase,
  updateCaseDocumentAssignment,
} from "../controllers/caseController.js";
import {
  backfillCaseTeams,
  createCaseWithRequiredCollaboration,
  getCaseCollaboration,
  getNewCaseCollaborationOptions,
  requireCompleteCaseTeam,
  updateCaseCollaboration,
  updateCaseWithRequiredCollaboration,
} from "../controllers/caseTeamController.js";
import {
  getCaseLifecycle,
  updateCaseLifecycle,
} from "../controllers/caseLifecycleController.js";
import {
  getCaseAssessment,
  saveCaseAssessment,
} from "../controllers/caseAssessmentController.js";
import {
  getCaseInformationWorkspace,
  getCaseTypeMatch,
} from "../controllers/caseInformationWorkspaceController.js";
import {
  patchCaseInformationSection,
  putCaseInformationSectionState,
} from "../controllers/caseInformationMutationController.js";
import { reviewQuestionnaireAssignment } from "../controllers/questionnaireReviewController.js";
import { createCaseLedgerEntry, deleteLedgerEntry, listCaseLedgerEntries, updateLedgerEntry } from "../controllers/manualLedgerController.js";
import {
  applyCaseWorkflowTemplate,
  createCaseTask,
  cancelCaseTask,
  getCaseWorkflow,
  saveCaseWorkflow,
  updateCaseWorkflowStep,
} from "../controllers/caseWorkflowController.js";
import { getCaseTimelineProgress } from "../controllers/caseTimelineProgressController.js";
import { asyncHandler } from "../utils/http.js";
import {
  createCaseApplicant,
  listCaseApplicants,
  removeCaseApplicant,
  updateCaseApplicant,
} from "../controllers/caseApplicantController.js";
import { requireCaseAccess, requireRole } from "../middleware/authorization.js";
import {
  listCaseRoleAssignments,
  removeCaseRoleAssignment,
  replaceCaseRoleAssignments,
} from "../controllers/caseRoleAssignmentController.js";
import {
  createCashPayment,
  createInvoice,
  createManualPayment,
  createInvoiceRefund,
  downloadInvoicePdf,
  listInvoices,
  voidInvoice,
  voidInvoicePayment,
} from "../controllers/caseInvoiceController.js";
import {
  createSchedule,
  getPaymentSummaries,
  getPaymentSummary,
  getSchedule,
  updateSchedule,
  voidInstallmentInvoice,
  voidSchedule,
} from "../controllers/paymentScheduleController.js";
import rateLimit from "../middleware/rateLimit.js";
import {
  approveCaseAccessRequest,
  declineCaseAccessRequest,
  requestCaseAccess,
  restrictedCasePreview,
  withdrawCaseAccessRequest,
  listReviewableCaseAccessRequests,
} from "../controllers/caseCollaborationController.js";
import {
  requirePortalCapability,
  requirePortalCaseTab,
} from "../services/portalAccessService.js";
import { getCasePortalPolicy, putCasePortalPolicy, resetCasePortalPolicy } from "../controllers/clientPortalPolicyController.js";

const router = Router();

router.get("/", asyncHandler(listCases));
router.get("/case-types", asyncHandler(listCaseTypes));
router.get("/study-intakes", asyncHandler(listStudyIntakes));
router.get("/collaboration-options", asyncHandler(getNewCaseCollaborationOptions));
router.post(
  "/collaboration-backfill",
  requireRole("admin"),
  rateLimit({ windowMs: 60_000, max: 5 }),
  asyncHandler(backfillCaseTeams),
);
router.get(
  "/payment-summaries",
  requirePortalCapability("financialData"),
  asyncHandler(getPaymentSummaries),
);
router.post("/", asyncHandler(createCaseWithRequiredCollaboration));
router.get("/access-requests/review", requireRole("admin", "consultant"), asyncHandler(listReviewableCaseAccessRequests));
router.get("/:id/access-preview", requireRole("consultant", "frontdesk"), asyncHandler(restrictedCasePreview));
router.post("/:id/access-requests", requireRole("consultant", "frontdesk"), rateLimit({ windowMs: 60_000, max: 20 }), asyncHandler(requestCaseAccess));
router.delete("/:id/access-requests/:requestId", requireRole("consultant", "frontdesk"), asyncHandler(withdrawCaseAccessRequest));
router.use("/:id", requireCaseAccess());
router.get("/:id/client-portal-policy", requireRole("admin", "consultant"), asyncHandler(getCasePortalPolicy));
router.put("/:id/client-portal-policy", requireRole("admin", "consultant"), rateLimit({ windowMs: 60_000, max: 30 }), asyncHandler(putCasePortalPolicy));
router.delete("/:id/client-portal-policy", requireRole("admin", "consultant"), asyncHandler(resetCasePortalPolicy));
router.post("/:id/access-requests/:requestId/approve", requireRole("admin", "consultant"), asyncHandler(approveCaseAccessRequest));
router.post("/:id/access-requests/:requestId/decline", requireRole("admin", "consultant"), asyncHandler(declineCaseAccessRequest));
router.get("/:id/lifecycle", asyncHandler(getCaseLifecycle));
router.patch(
  "/:id/lifecycle",
  requireRole("admin", "consultant"),
  asyncHandler(requireCompleteCaseTeam),
  asyncHandler(updateCaseLifecycle),
);
router.get("/:id/permissions", asyncHandler(getCaseCollaboration));
router.put("/:id/permissions", asyncHandler(updateCaseCollaboration));
router.get("/:id/roles", asyncHandler(listCaseRoleAssignments));
router.put("/:id/roles", asyncHandler(replaceCaseRoleAssignments));
router.delete("/:id/roles/:assignmentId", asyncHandler(removeCaseRoleAssignment));
router.get(
  "/:id/assessment",
  requirePortalCaseTab("profile"),
  asyncHandler(getCaseAssessment),
);
router.get(
  "/:id/information-workspace",
  requirePortalCaseTab("profile"),
  asyncHandler(getCaseInformationWorkspace),
);
router.get(
  "/:id/case-type-match",
  requirePortalCaseTab("profile"),
  asyncHandler(getCaseTypeMatch),
);
router.patch(
  "/:id/information-sections/:sectionKey",
  requirePortalCaseTab("profile"),
  requireRole("admin", "consultant"),
  rateLimit({ windowMs: 60_000, max: 60 }),
  asyncHandler(patchCaseInformationSection),
);
router.put(
  "/:id/information-sections/:sectionKey/state",
  requirePortalCaseTab("profile"),
  requireRole("admin", "consultant"),
  rateLimit({ windowMs: 60_000, max: 60 }),
  asyncHandler(putCaseInformationSectionState),
);
router.post(
  "/:id/questionnaire-assignments/:assignmentId/review",
  requirePortalCaseTab("questionnaires"),
  requireRole("admin", "consultant"),
  rateLimit({ windowMs: 60_000, max: 30 }),
  asyncHandler(reviewQuestionnaireAssignment),
);
router.get("/:id/applicants", asyncHandler(listCaseApplicants));
router.post("/:id/applicants", requireRole("admin", "consultant"), asyncHandler(createCaseApplicant));
router.patch("/:id/applicants/:applicantId", requireRole("admin", "consultant"), asyncHandler(updateCaseApplicant));
router.delete(
  "/:id/applicants/:applicantId",
  requireRole("admin", "consultant"),
  asyncHandler(removeCaseApplicant),
);
router.patch(
  "/:id/assessment",
  requirePortalCaseTab("profile"),
  requireRole("admin", "consultant"),
  asyncHandler(saveCaseAssessment),
);
router.get("/:id/workflow", asyncHandler(getCaseWorkflow));
router.get("/:id/timeline-progress", asyncHandler(getCaseTimelineProgress));
router.post(
  "/:id/tasks",
  requirePortalCaseTab("tasks"),
  asyncHandler(createCaseTask),
);
router.patch(
  "/:id/tasks/:taskId/cancel",
  requirePortalCaseTab("tasks"),
  asyncHandler(cancelCaseTask),
);
router.post(
  "/:id/document-checklist",
  requirePortalCaseTab("documents"),
  asyncHandler(createCaseDocumentChecklist),
);
router.patch(
  "/:id/document-assignment",
  requirePortalCaseTab("documents"),
  asyncHandler(updateCaseDocumentAssignment),
);
router.post(
  "/:id/workflow/apply-template",
  requireRole("admin", "consultant"),
  asyncHandler(applyCaseWorkflowTemplate),
);
router.patch("/:id/workflow", requireRole("admin", "consultant"), asyncHandler(saveCaseWorkflow));
router.patch("/:id/workflow/:stepId", requireRole("admin", "consultant"), asyncHandler(updateCaseWorkflowStep));
router.get("/:id/ledger", asyncHandler(listCaseLedgerEntries));
router.post("/:id/ledger", requireRole("admin", "consultant"), asyncHandler(createCaseLedgerEntry));
router.patch("/:id/ledger/:entryId", requireRole("admin", "consultant"), asyncHandler(updateLedgerEntry));
router.delete("/:id/ledger/:entryId", requireRole("admin", "consultant"), asyncHandler(deleteLedgerEntry));
router.get("/:id", asyncHandler(getCaseById));
router.patch("/:id", requireRole("admin", "consultant"), asyncHandler(updateCaseWithRequiredCollaboration));
router.patch(
  "/:id/close",
  requireRole("admin", "consultant"),
  asyncHandler(requireCompleteCaseTeam),
  asyncHandler(closeCase),
);
router.patch("/:id/archive", requireRole("admin", "consultant"), asyncHandler(archiveCase));
router.patch("/:id/unarchive", requireRole("admin", "consultant"), asyncHandler(unarchiveCase));
router.delete("/:id", requireRole("admin", "consultant"), asyncHandler(softDeleteCase));
router.patch("/:id/restore", requireRole("admin", "consultant"), asyncHandler(restoreCase));
router.get(
  "/:id/invoices",
  requirePortalCaseTab("billing"),
  requirePortalCapability("financialData"),
  asyncHandler(listInvoices),
);
router.post(
  "/:id/invoices",
  requirePortalCaseTab("billing"),
  requirePortalCapability("financialData"),
  requireRole("admin", "consultant"),
  rateLimit({ windowMs: 60_000, max: 20 }),
  asyncHandler(createInvoice),
);
router.post(
  "/:id/invoices/:invoiceId/cash-payment",
  requirePortalCaseTab("billing"),
  requirePortalCapability("financialData"),
  requireRole("admin", "consultant"),
  rateLimit({ windowMs: 60_000, max: 20 }),
  asyncHandler(createCashPayment),
);
router.post(
  "/:id/invoices/:invoiceId/manual-payment",
  requirePortalCaseTab("billing"),
  requirePortalCapability("financialData"),
  requireRole("admin", "consultant"),
  rateLimit({ windowMs: 60_000, max: 20 }),
  asyncHandler(createManualPayment),
);
router.post(
  "/:id/invoices/:invoiceId/refunds",
  requirePortalCaseTab("billing"),
  requirePortalCapability("financialData"),
  requireRole("admin", "accountant"),
  rateLimit({ windowMs: 60_000, max: 20 }),
  asyncHandler(createInvoiceRefund),
);
router.post(
  "/:id/invoices/:invoiceId/void",
  requirePortalCaseTab("billing"),
  requirePortalCapability("financialData"),
  requireRole("admin"),
  rateLimit({ windowMs: 60_000, max: 20 }),
  asyncHandler(voidInvoice),
);
router.post(
  "/:id/invoices/:invoiceId/void-payment",
  requirePortalCaseTab("billing"),
  requirePortalCapability("financialData"),
  requireRole("admin"),
  rateLimit({ windowMs: 60_000, max: 20 }),
  asyncHandler(voidInvoicePayment),
);
router.get(
  "/:id/invoices/:invoiceId/pdf",
  requirePortalCaseTab("billing"),
  requirePortalCapability("financialData"),
  asyncHandler(downloadInvoicePdf),
);
router.get(
  "/:id/payment-summary",
  requirePortalCapability("financialData"),
  asyncHandler(getPaymentSummary),
);
router.get(
  "/:id/payment-schedule",
  requirePortalCaseTab("billing"),
  requirePortalCapability("financialData"),
  asyncHandler(getSchedule),
);
router.post(
  "/:id/payment-schedule",
  requirePortalCaseTab("billing"),
  requirePortalCapability("financialData"),
  requireRole("admin", "consultant"),
  rateLimit({ windowMs: 60_000, max: 10 }),
  asyncHandler(createSchedule),
);
router.patch(
  "/:id/payment-schedule",
  requirePortalCaseTab("billing"),
  requirePortalCapability("financialData"),
  requireRole("admin", "consultant"),
  rateLimit({ windowMs: 60_000, max: 20 }),
  asyncHandler(updateSchedule),
);
router.post(
  "/:id/payment-schedule/void",
  requirePortalCaseTab("billing"),
  requirePortalCapability("financialData"),
  requireRole("admin"),
  rateLimit({ windowMs: 60_000, max: 10 }),
  asyncHandler(voidSchedule),
);
router.post(
  "/:id/payment-schedule/installments/:installmentId/void",
  requirePortalCaseTab("billing"),
  requirePortalCapability("financialData"),
  requireRole("admin"),
  rateLimit({ windowMs: 60_000, max: 10 }),
  asyncHandler(voidInstallmentInvoice),
);

export default router;
