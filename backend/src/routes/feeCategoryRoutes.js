import { Router } from "express";
import { create, list, remove, update } from "../controllers/feeCategoryController.js";
import { requireRole } from "../middleware/authorization.js";
import rateLimit from "../middleware/rateLimit.js";
import { asyncHandler } from "../utils/http.js";

const router = Router();

router.get("/", asyncHandler(list));
router.post("/", requireRole("admin"), rateLimit({ windowMs: 60_000, max: 30 }), asyncHandler(create));
router.patch("/:id", requireRole("admin"), rateLimit({ windowMs: 60_000, max: 60 }), asyncHandler(update));
router.delete("/:id", requireRole("admin"), rateLimit({ windowMs: 60_000, max: 30 }), asyncHandler(remove));

export default router;
