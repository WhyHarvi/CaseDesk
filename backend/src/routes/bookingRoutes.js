import { Router } from "express";
import {
  cancelBookingAppointment,
  createBookingAppointment,
  createSessionType,
  deleteSessionType,
  getAvailability,
  getBookingSettings,
  listCalendarAppointments,
  rescheduleBookingAppointment,
  updateBookingSettings,
  updateSessionType,
  updateSchedulingStaff,
  getSchedulingAnalytics,
  convertAppointmentToClient,
  updateBookingAppointmentStatus,
  listAppointmentRegistry,
  getAppointmentRegistryDetail,
  listSchedulingBlocks,
  createSchedulingBlock,
  deleteSchedulingBlock,
  listBookingWaitlist,
  updateBookingWaitlistEntry,
  previewBookingEmailTemplate,
  testBookingEmailTemplate,
  createWalkInPayNowLink,
  recordWalkInManualPayment,
  getFreeConsultationEligibility,
  lookupBookingClients,
  getBookingPaymentHoldById,
  resendBookingPaymentHoldRequest,
  cancelBookingPaymentHoldRequest,
  getAppointmentRefundEstimate,
  updatePaidAppointmentPaymentDetails,
} from "../controllers/bookingController.js";
import { asyncHandler } from "../utils/http.js";

const router = Router();

router.get("/settings", asyncHandler(getBookingSettings));
router.put("/settings", asyncHandler(updateBookingSettings));
router.post("/session-types", asyncHandler(createSessionType));
router.patch("/session-types/:id", asyncHandler(updateSessionType));
router.patch("/staff/:userId", asyncHandler(updateSchedulingStaff));
router.get("/analytics", asyncHandler(getSchedulingAnalytics));
router.get("/free-consultation-eligibility", asyncHandler(getFreeConsultationEligibility));
router.get("/client-lookup", asyncHandler(lookupBookingClients));
router.get("/payment-holds/:id", asyncHandler(getBookingPaymentHoldById));
router.post("/payment-holds/:id/resend", asyncHandler(resendBookingPaymentHoldRequest));
router.post("/payment-holds/:id/cancel", asyncHandler(cancelBookingPaymentHoldRequest));
router.get("/appointments/registry", asyncHandler(listAppointmentRegistry));
router.get("/appointments/:id/detail", asyncHandler(getAppointmentRegistryDetail));
router.get("/appointments/:id/refund-estimate", asyncHandler(getAppointmentRefundEstimate));
router.get("/blocks", asyncHandler(listSchedulingBlocks));
router.post("/blocks", asyncHandler(createSchedulingBlock));
router.delete("/blocks/:id", asyncHandler(deleteSchedulingBlock));
router.get("/waitlist", asyncHandler(listBookingWaitlist));
router.patch("/waitlist/:id", asyncHandler(updateBookingWaitlistEntry));
router.post("/settings/email-preview", asyncHandler(previewBookingEmailTemplate));
router.post("/settings/test-email", asyncHandler(testBookingEmailTemplate));
router.delete("/session-types/:id", asyncHandler(deleteSessionType));
router.get("/availability", asyncHandler(getAvailability));
router.get("/calendar", asyncHandler(listCalendarAppointments));
router.post("/appointments", asyncHandler(createBookingAppointment));
router.patch("/appointments/:id/cancel", asyncHandler(cancelBookingAppointment));
router.patch("/appointments/:id/reschedule", asyncHandler(rescheduleBookingAppointment));
router.patch("/appointments/:id/status", asyncHandler(updateBookingAppointmentStatus));
router.post("/appointments/:id/convert-client", asyncHandler(convertAppointmentToClient));
router.post("/appointments/:id/pay-now-link", asyncHandler(createWalkInPayNowLink));
router.post("/appointments/:id/manual-payment", asyncHandler(recordWalkInManualPayment));
router.patch("/appointments/:id/payment-details", asyncHandler(updatePaidAppointmentPaymentDetails));

export default router;
