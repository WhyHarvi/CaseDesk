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
} from "../controllers/bookingController.js";
import { asyncHandler } from "../utils/http.js";

const router = Router();

router.get("/settings", asyncHandler(getBookingSettings));
router.put("/settings", asyncHandler(updateBookingSettings));
router.post("/settings/regenerate-token", asyncHandler(regeneratePublicToken));
router.post("/session-types", asyncHandler(createSessionType));
router.patch("/session-types/:id", asyncHandler(updateSessionType));
router.delete("/session-types/:id", asyncHandler(deleteSessionType));
router.get("/availability", asyncHandler(getAvailability));
router.get("/calendar", asyncHandler(listCalendarAppointments));
router.post("/appointments", asyncHandler(createBookingAppointment));
router.patch("/appointments/:id/cancel", asyncHandler(cancelBookingAppointment));
router.patch("/appointments/:id/reschedule", asyncHandler(rescheduleBookingAppointment));

export default router;
