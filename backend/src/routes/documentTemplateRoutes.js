import { Router } from "express";
import {
  createDocumentTemplate,
  deleteDocumentTemplate,
  getDocumentTemplateById,
  listDocumentProgramCatalog,
  listDocumentTemplates,
  updateDocumentTemplate,
} from "../controllers/documentTemplateController.js";
import { asyncHandler } from "../utils/http.js";

const router = Router();

router.get("/catalog", asyncHandler(listDocumentProgramCatalog));
router.get("/", asyncHandler(listDocumentTemplates));
router.get("/:id", asyncHandler(getDocumentTemplateById));
router.post("/", asyncHandler(createDocumentTemplate));
router.patch("/:id", asyncHandler(updateDocumentTemplate));
router.delete("/:id", asyncHandler(deleteDocumentTemplate));

export default router;
