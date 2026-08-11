import { Router } from "express";
import { asyncHandler } from "../utils/http.js";
import { receiveDocumentFile } from "../middleware/documentUploadMiddleware.js";
import { rateLimit } from "../middleware/rateLimit.js";
import {
  createMessage,
  createThread,
  getThread,
  getThreadRealtimeConfig,
  listMyColleagues,
  listThreads,
  markThreadRead,
  serveThreadAttachment,
  uploadThreadAttachment,
} from "../controllers/internalChatController.js";

const router = Router();

router.get("/colleagues", asyncHandler(listMyColleagues));
router.get("/threads", asyncHandler(listThreads));
router.post("/threads", rateLimit({ windowMs: 60_000, max: 20 }), asyncHandler(createThread));
router.get("/threads/:id", asyncHandler(getThread));
router.get("/threads/:id/realtime", asyncHandler(getThreadRealtimeConfig));
router.post("/threads/:id/read", asyncHandler(markThreadRead));
router.post("/threads/:id/messages", rateLimit({ windowMs: 60_000, max: 30 }), asyncHandler(createMessage));
router.post(
  "/threads/:id/messages/:messageId/attachments",
  rateLimit({ windowMs: 60_000, max: 10 }),
  receiveDocumentFile,
  asyncHandler(uploadThreadAttachment),
);
router.get("/threads/:id/attachments/:attachmentId/file", asyncHandler(serveThreadAttachment));

export default router;
