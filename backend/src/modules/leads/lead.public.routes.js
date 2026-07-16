import { Router } from "express";
import { rateLimit } from "../../middleware/rateLimit.js";
import { asyncHandler } from "../../utils/http.js";
import { getPublicForm, submitPublicForm } from "./lead.intake.controller.js";

const router = Router();
router.get("/:token", rateLimit({ max: 60 }), asyncHandler(getPublicForm));
router.post("/:token", rateLimit({ windowMs: 10 * 60_000, max: 10 }), asyncHandler(submitPublicForm));
export default router;

