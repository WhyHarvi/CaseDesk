import { Router } from "express";
import { createWrittenDocument, deleteWrittenDocument, getWrittenDocument, listWrittenDocuments, restoreWrittenDocumentVersion, saveWrittenDocumentVersion, updateWrittenDocumentDraft } from "../controllers/writtenDocumentController.js";
import { asyncHandler } from "../utils/http.js";

const router = Router();
router.get("/", asyncHandler(listWrittenDocuments));
router.post("/", asyncHandler(createWrittenDocument));
router.get("/:id", asyncHandler(getWrittenDocument));
router.delete("/:id", asyncHandler(deleteWrittenDocument));
router.patch("/:id/draft", asyncHandler(updateWrittenDocumentDraft));
router.post("/:id/versions", asyncHandler(saveWrittenDocumentVersion));
router.post("/:id/versions/:versionId/restore", asyncHandler(restoreWrittenDocumentVersion));
export default router;
