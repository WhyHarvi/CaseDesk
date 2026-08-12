import { Router } from "express";
import { asyncHandler } from "../utils/http.js";
import { receiveDocumentFile } from "../middleware/documentUploadMiddleware.js";
import { receiveProfileAvatar } from "../middleware/profileAvatarUpload.js";
import { rateLimit } from "../middleware/rateLimit.js";
import {
  addParticipants,
  createMessage,
  createThread,
  deleteMessage,
  getThread,
  getThreadRealtimeConfig,
  listMyColleagues,
  listThreads,
  markThreadRead,
  removeParticipant,
  serveThreadAttachment,
  serveThreadAvatar,
  toggleReaction,
  updateMessage,
  updateThread,
  uploadThreadAttachment,
} from "../controllers/internalChatController.js";

const router = Router();

router.get("/colleagues", asyncHandler(listMyColleagues));
router.get("/threads", asyncHandler(listThreads));
router.post("/threads", rateLimit({ windowMs: 60_000, max: 20 }), asyncHandler(createThread));
router.get("/threads/:id", asyncHandler(getThread));
router.patch("/threads/:id", rateLimit({ windowMs: 60_000, max: 20 }), receiveProfileAvatar, asyncHandler(updateThread));
router.get("/threads/:id/avatar", asyncHandler(serveThreadAvatar));
router.post("/threads/:id/participants", rateLimit({ windowMs: 60_000, max: 20 }), asyncHandler(addParticipants));
router.delete("/threads/:id/participants/:userId", asyncHandler(removeParticipant));
router.get("/threads/:id/realtime", asyncHandler(getThreadRealtimeConfig));
router.post("/threads/:id/read", asyncHandler(markThreadRead));
router.post("/threads/:id/messages", rateLimit({ windowMs: 60_000, max: 30 }), asyncHandler(createMessage));
router.patch("/threads/:id/messages/:messageId", rateLimit({ windowMs: 60_000, max: 30 }), asyncHandler(updateMessage));
router.delete("/threads/:id/messages/:messageId", asyncHandler(deleteMessage));
router.post("/threads/:id/messages/:messageId/reactions", rateLimit({ windowMs: 60_000, max: 60 }), asyncHandler(toggleReaction));
router.post(
  "/threads/:id/messages/:messageId/attachments",
  rateLimit({ windowMs: 60_000, max: 10 }),
  receiveDocumentFile,
  asyncHandler(uploadThreadAttachment),
);
router.get("/threads/:id/attachments/:attachmentId/file", asyncHandler(serveThreadAttachment));

export default router;
