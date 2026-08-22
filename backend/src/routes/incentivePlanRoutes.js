import { Router } from "express";
import { activate, approveRetroactiveApprovals, applyLegacyInvoices, applyRecalculation, create, deactivate, get, list, previewLegacyInvoices, previewRecalculation, previewRetroactiveApprovals, remove, update } from "../controllers/incentivePlanController.js";
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
router.post("/:id/deactivate", rateLimit({ windowMs: 60_000, max: 30 }), asyncHandler(deactivate));
router.get("/:id/legacy-invoices", asyncHandler(previewLegacyInvoices));
router.post("/:id/legacy-invoices/apply", rateLimit({ windowMs: 60_000, max: 5 }), asyncHandler(applyLegacyInvoices));
router.get("/:id/retroactive-approvals", asyncHandler(previewRetroactiveApprovals));
router.post("/:id/retroactive-approvals/approve", rateLimit({ windowMs: 60_000, max: 5 }), asyncHandler(approveRetroactiveApprovals));
router.get("/:id/recalculation", asyncHandler(previewRecalculation));
router.post("/:id/recalculation/apply", rateLimit({ windowMs: 60_000, max: 5 }), asyncHandler(applyRecalculation));
router.delete("/:id", rateLimit({ windowMs: 60_000, max: 30 }), asyncHandler(remove));

export default router;
