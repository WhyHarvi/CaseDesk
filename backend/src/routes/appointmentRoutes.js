import { Router } from "express";
import { createAppointment, deleteAppointment, listCaseAppointments, updateAppointment } from "../controllers/appointmentController.js";
import { asyncHandler } from "../utils/http.js";
import { requireRole } from "../middleware/authorization.js";
import {
  confirmAppointmentAdviceController,
  checkInAppointmentClient,
  createAppointmentFollowUp,
  createAppointmentNote,
  getAppointmentProfile,
  saveAppointmentAdviceDraftController,
  updateAppointmentProfileContext,
} from "../controllers/appointmentProfileController.js";

const router = Router();
router.get("/case/:caseId", asyncHandler(listCaseAppointments));
router.get("/:id/profile", asyncHandler(getAppointmentProfile));
router.patch("/:id/profile", requireRole("admin", "consultant", "frontdesk"), asyncHandler(updateAppointmentProfileContext));
router.post("/:id/notes", requireRole("admin", "consultant"), asyncHandler(createAppointmentNote));
router.post("/:id/follow-ups", requireRole("admin", "consultant"), asyncHandler(createAppointmentFollowUp));
router.post("/:id/advice/draft", requireRole("admin", "consultant"), asyncHandler(saveAppointmentAdviceDraftController));
router.post("/:id/advice/confirm", requireRole("admin", "consultant"), asyncHandler(confirmAppointmentAdviceController));
router.post("/:id/check-in", requireRole("admin", "frontdesk"), asyncHandler(checkInAppointmentClient));
router.post("/", asyncHandler(createAppointment));
router.patch("/:id", asyncHandler(updateAppointment));
router.delete("/:id", asyncHandler(deleteAppointment));

export default router;
