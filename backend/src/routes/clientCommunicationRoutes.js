import { Router } from "express";
import {
  createClientChatMessage,
  getClientChat,
} from "../controllers/clientCommunicationController.js";
import { asyncHandler } from "../utils/http.js";

const router = Router();
router.get("/:token", asyncHandler(getClientChat));
router.post("/:token/messages", asyncHandler(createClientChatMessage));
export default router;
