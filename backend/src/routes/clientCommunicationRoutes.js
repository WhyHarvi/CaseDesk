import { Router } from "express";
import {
  createClientChatMessage,
  getClientChat,
  markClientChatRead,
  serveClientChatAttachment,
  uploadClientChatAttachment,
} from "../controllers/clientCommunicationController.js";
import { receiveDocumentFile } from "../middleware/documentUploadMiddleware.js";
import { asyncHandler } from "../utils/http.js";

const router = Router();
router.get("/:token", asyncHandler(getClientChat));
router.post("/:token/messages", asyncHandler(createClientChatMessage));
router.post("/:token/messages/:id/attachments", receiveDocumentFile, asyncHandler(uploadClientChatAttachment));
router.get("/:token/messages/:id/attachments/:attachmentId/file", asyncHandler(serveClientChatAttachment));
router.post("/:token/messages/read", asyncHandler(markClientChatRead));
export default router;
