import { Router } from "express";
import { createCorrespondenceDraft, createCorrespondenceTemplate, createCustomCorrespondenceDraft, deleteCaseCorrespondence, deleteCorrespondenceTemplate, listCaseCorrespondence, listCorrespondenceTemplates, listCorrespondenceTemplateVersions, restoreCorrespondenceTemplateVersion, updateCorrespondenceStatus, updateCorrespondenceTemplate } from "../controllers/correspondenceController.js";
import { asyncHandler } from "../utils/http.js";

const router = Router();
router.get("/templates", asyncHandler(listCorrespondenceTemplates));
router.post("/templates", asyncHandler(createCorrespondenceTemplate));
router.patch("/templates/:id", asyncHandler(updateCorrespondenceTemplate));
router.delete("/templates/:id", asyncHandler(deleteCorrespondenceTemplate));
router.get("/templates/:id/versions", asyncHandler(listCorrespondenceTemplateVersions));
router.post("/templates/:id/versions/:versionId/restore", asyncHandler(restoreCorrespondenceTemplateVersion));
router.post("/templates/:id/create-draft", asyncHandler(createCorrespondenceDraft));
router.post("/drafts/custom", asyncHandler(createCustomCorrespondenceDraft));
router.get("/case/:caseId", asyncHandler(listCaseCorrespondence));
router.patch("/documents/:id/status", asyncHandler(updateCorrespondenceStatus));
router.delete("/documents/:id", asyncHandler(deleteCaseCorrespondence));
export default router;
