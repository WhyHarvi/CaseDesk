import { Router } from "express";
import { activate, create, get, list, remove, update } from "../controllers/incentivePlanController.js";
import { requireRole } from "../middleware/authorization.js";
import rateLimit from "../middleware/rateLimit.js";
import { asyncHandler } from "../utils/http.js";

const router = Router();

router.use(requireRole("admin"));
router.get("/", asyncHandler(list));
router.get("/:id", asyncHandler(get));
router.post("/", rateLimit({ windowMs: 60_000, max: 30 }), asyncHandler(create));
router.patch("/:id", rateLimit({ windowMs: 60_000, max: 60 }), asyncHandler(update));
router.post("/:id/activate", rateLimit({ windowMs: 60_000, max: 30 }), asyncHandler(activate));
router.delete("/:id", rateLimit({ windowMs: 60_000, max: 30 }), asyncHandler(remove));

export default router;
