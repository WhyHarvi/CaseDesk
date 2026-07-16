import { Router } from "express";
import { addSharedLibraryDocumentToCase, deleteSharedLibraryDocument, listSharedLibraryDocuments, serveSharedLibraryDocument, updateSharedLibraryDocument, uploadSharedLibraryDocument } from "../controllers/sharedLibraryController.js";
import { receiveDocumentFile } from "../middleware/documentUploadMiddleware.js";
import { asyncHandler } from "../utils/http.js";

const router = Router();
router.get("/", asyncHandler(listSharedLibraryDocuments));
router.post("/upload", receiveDocumentFile, asyncHandler(uploadSharedLibraryDocument));
router.get("/:id/file", asyncHandler(serveSharedLibraryDocument));
router.post("/:id/add-to-case", asyncHandler(addSharedLibraryDocumentToCase));
router.patch("/:id", asyncHandler(updateSharedLibraryDocument));
router.delete("/:id", asyncHandler(deleteSharedLibraryDocument));
export default router;
