import { Router } from "express";
import {
  createTemplate,
  deleteTemplate,
  getPaymentCommunicationSettings,
  getTemplates,
  updateTemplate,
  updatePaymentCommunicationSettings,
} from "../controllers/paymentScheduleController.js";
import { asyncHandler } from "../utils/http.js";

const router = Router();

router.get("/settings", asyncHandler(getPaymentCommunicationSettings));
router.patch("/settings", asyncHandler(updatePaymentCommunicationSettings));
router.get("/templates", asyncHandler(getTemplates));
router.post("/templates", asyncHandler(createTemplate));
router.patch("/templates/:templateId", asyncHandler(updateTemplate));
router.delete("/templates/:templateId", asyncHandler(deleteTemplate));

export default router;
