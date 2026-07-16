import { Router } from "express";
import {
  createWorkflowTemplate,
  deleteWorkflowTemplate,
  listWorkflowTemplates,
} from "../controllers/workflowTemplateController.js";
import { asyncHandler } from "../utils/http.js";

const router = Router();

router.get("/", asyncHandler(listWorkflowTemplates));
router.post("/", asyncHandler(createWorkflowTemplate));
router.delete("/:id", asyncHandler(deleteWorkflowTemplate));

export default router;
