import { Router } from "express";
import { addAgencyFormTemplateToCase, createAgencyFormTemplate, deleteAgencyFormTemplate, listAgencyFormTemplates, listAgencyFormTemplateVersions, replaceAgencyFormTemplate, saveCaseFormAsAgencyTemplate, serveAgencyFormTemplate, updateAgencyFormTemplate } from "../controllers/agencyFormTemplateController.js";
import { receiveDocumentFile } from "../middleware/documentUploadMiddleware.js";
import { asyncHandler } from "../utils/http.js";

const router = Router();
router.get("/", asyncHandler(listAgencyFormTemplates));
router.post("/upload", receiveDocumentFile, asyncHandler(createAgencyFormTemplate));
router.post("/from-case-form/:caseFormId", asyncHandler(saveCaseFormAsAgencyTemplate));
router.get("/:id/file", asyncHandler(serveAgencyFormTemplate));
router.get("/:id/versions", asyncHandler(listAgencyFormTemplateVersions));
router.get("/:id/versions/:versionId/file", asyncHandler(serveAgencyFormTemplate));
router.post("/:id/add-to-case", asyncHandler(addAgencyFormTemplateToCase));
router.post("/:id/replace", receiveDocumentFile, asyncHandler(replaceAgencyFormTemplate));
router.patch("/:id", asyncHandler(updateAgencyFormTemplate));
router.delete("/:id", asyncHandler(deleteAgencyFormTemplate));
export default router;
