import { Router } from "express";
import {
  cancelBookingAppointment,
  createBookingAppointment,
  createSessionType,
  deleteSessionType,
  getAvailability,
  getBookingSettings,
  listCalendarAppointments,
  regeneratePublicToken,
  rescheduleBookingAppointment,
  updateBookingSettings,
  updateSessionType,
  updateSchedulingStaff,
  getSchedulingAnalytics,
  convertAppointmentToClient,
  updateBookingAppointmentStatus,
} from "../controllers/bookingController.js";
import { asyncHandler } from "../utils/http.js";

const router = Router();

router.get("/settings", asyncHandler(getBookingSettings));
router.put("/settings", asyncHandler(updateBookingSettings));
router.post("/settings/regenerate-token", asyncHandler(regeneratePublicToken));
router.post("/session-types", asyncHandler(createSessionType));
router.patch("/session-types/:id", asyncHandler(updateSessionType));
router.patch("/staff/:userId", asyncHandler(updateSchedulingStaff));
router.get("/analytics", asyncHandler(getSchedulingAnalytics));
router.delete("/session-types/:id", asyncHandler(deleteSessionType));
router.get("/availability", asyncHandler(getAvailability));
router.get("/calendar", asyncHandler(listCalendarAppointments));
router.post("/appointments", asyncHandler(createBookingAppointment));
router.patch("/appointments/:id/cancel", asyncHandler(cancelBookingAppointment));
router.patch("/appointments/:id/reschedule", asyncHandler(rescheduleBookingAppointment));
router.patch("/appointments/:id/status", asyncHandler(updateBookingAppointmentStatus));
router.post("/appointments/:id/convert-client", asyncHandler(convertAppointmentToClient));

export default router;
