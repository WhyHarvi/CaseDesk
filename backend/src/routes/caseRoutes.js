import { Router } from "express";
import {
  createCase,
  closeCase,
  createCaseDocumentChecklist,
  getCaseById,
  listCases,
  updateCaseDocumentAssignment,
  updateCase,
} from "../controllers/caseController.js";
import {
  getCaseAssessment,
  saveCaseAssessment,
} from "../controllers/caseAssessmentController.js";
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
import { requireCaseAccess } from "../middleware/authorization.js";

const router = Router();

router.get("/", asyncHandler(listCases));
router.post("/", asyncHandler(createCase));
router.use("/:id", requireCaseAccess());
router.get("/:id/assessment", asyncHandler(getCaseAssessment));
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

export default router;
