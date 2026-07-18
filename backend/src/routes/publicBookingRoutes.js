import { Router } from "express";
import rateLimit from "../middleware/rateLimit.js";
import {
  cancelManagedBooking,
  createPublicBooking,
  getManagedAvailability,
  getManagedBooking,
  getPublicAvailability,
  getPublicBookingInfo,
  rescheduleManagedBooking,
} from "../controllers/publicBookingController.js";
import { asyncHandler } from "../utils/http.js";

const router = Router();
const readLimit = rateLimit({ windowMs: 60_000, max: 60 });
const writeLimit = rateLimit({ windowMs: 15 * 60_000, max: 10 });

router.get("/manage/:manageToken", readLimit, asyncHandler(getManagedBooking));
router.get("/manage/:manageToken/availability", readLimit, asyncHandler(getManagedAvailability));
router.post("/manage/:manageToken/cancel", writeLimit, asyncHandler(cancelManagedBooking));
router.post("/manage/:manageToken/reschedule", writeLimit, asyncHandler(rescheduleManagedBooking));
router.get("/:token", readLimit, asyncHandler(getPublicBookingInfo));
router.get("/:token/availability", readLimit, asyncHandler(getPublicAvailability));
router.post("/:token/appointments", writeLimit, asyncHandler(createPublicBooking));

export default router;
