import { Router } from "express";
import {
  createClientDocument,
  deleteClientDocument,
  finalizeClientDocument,
  getClientDocumentById,
  listClientDocuments,
  serveClientDocumentFile,
  uploadClientDocumentFile,
  updateClientDocument,
  updateClientDocumentStatus,
} from "../controllers/clientDocumentController.js";
import { receiveDocumentFile } from "../middleware/documentUploadMiddleware.js";
import { asyncHandler } from "../utils/http.js";

const router = Router();

router.get("/", asyncHandler(listClientDocuments));
router.post("/upload", receiveDocumentFile, asyncHandler(uploadClientDocumentFile));
router.post("/:id/finalize", asyncHandler(finalizeClientDocument));
router.post("/:id/status", asyncHandler(updateClientDocumentStatus));
router.get("/:id/file", asyncHandler(serveClientDocumentFile));
router.get("/:id", asyncHandler(getClientDocumentById));
router.post("/", asyncHandler(createClientDocument));
router.patch("/:id", asyncHandler(updateClientDocument));
router.delete("/:id", asyncHandler(deleteClientDocument));

export default router;
