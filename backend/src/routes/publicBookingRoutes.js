import { Router } from "express";
import rateLimit from "../middleware/rateLimit.js";
import {
  cancelManagedBooking,
  createPublicBooking,
  createPublicBookingPaymentHold,
  getManagedAvailability,
  getManagedBooking,
  getPublicAvailability,
  getPublicBookingInfo,
  getPublicBookingAvatar,
  getPublicBookingPaymentHoldStatus,
  rescheduleManagedBooking,
  confirmManagedBooking,
  completeManagedPreparation,
  joinPublicWaitlist,
  requestBookingVerification,
  verifyBookingEmail,
} from "../controllers/publicBookingController.js";
import { asyncHandler } from "../utils/http.js";

const router = Router();
const readLimit = rateLimit({ windowMs: 60_000, max: 60 });
const writeLimit = rateLimit({ windowMs: 15 * 60_000, max: 10 });

router.get("/manage/:manageToken", readLimit, asyncHandler(getManagedBooking));
router.get("/manage/:manageToken/availability", readLimit, asyncHandler(getManagedAvailability));
router.post("/manage/:manageToken/cancel", writeLimit, asyncHandler(cancelManagedBooking));
router.post("/manage/:manageToken/reschedule", writeLimit, asyncHandler(rescheduleManagedBooking));
router.post("/manage/:manageToken/confirm", writeLimit, asyncHandler(confirmManagedBooking));
router.post("/manage/:manageToken/preparation-complete", writeLimit, asyncHandler(completeManagedPreparation));
router.get("/:token", readLimit, asyncHandler(getPublicBookingInfo));
router.get("/:token/avatar", readLimit, asyncHandler(getPublicBookingAvatar));
router.get("/:token/availability", readLimit, asyncHandler(getPublicAvailability));
router.post("/:token/appointments", writeLimit, asyncHandler(createPublicBooking));
router.post("/:token/payment-hold", writeLimit, asyncHandler(createPublicBookingPaymentHold));
router.get("/:token/payment-hold/:claimToken", readLimit, asyncHandler(getPublicBookingPaymentHoldStatus));
router.post("/:token/waitlist", writeLimit, asyncHandler(joinPublicWaitlist));
router.post("/:token/verification/request", writeLimit, asyncHandler(requestBookingVerification));
router.post("/:token/verification/verify", writeLimit, asyncHandler(verifyBookingEmail));

export default router;
