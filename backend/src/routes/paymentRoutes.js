import { Router } from "express";
import {
  createPayment,
  deletePayment,
  getPaymentById,
  listPayments,
  updatePayment,
} from "../controllers/paymentController.js";
import { asyncHandler } from "../utils/http.js";
import { requireRole } from "../middleware/authorization.js";

const router = Router();

router.get("/", asyncHandler(listPayments));
router.get("/:id", asyncHandler(getPaymentById));
router.post("/", requireRole("admin"), asyncHandler(createPayment));
router.patch("/:id", requireRole("admin"), asyncHandler(updatePayment));
router.delete("/:id", requireRole("admin"), asyncHandler(deletePayment));

export default router;
