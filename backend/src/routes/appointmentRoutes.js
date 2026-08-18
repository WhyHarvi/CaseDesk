import { Router } from "express";
import { createAppointment, deleteAppointment, listCaseAppointments, updateAppointment } from "../controllers/appointmentController.js";
import { asyncHandler } from "../utils/http.js";
import { requireRole } from "../middleware/authorization.js";
import {
  createAppointmentFollowUp,
  createAppointmentNote,
  getAppointmentProfile,
  updateAppointmentProfileContext,
} from "../controllers/appointmentProfileController.js";

const router = Router();
router.get("/case/:caseId", asyncHandler(listCaseAppointments));
router.get("/:id/profile", asyncHandler(getAppointmentProfile));
router.patch("/:id/profile", requireRole("admin", "consultant", "frontdesk"), asyncHandler(updateAppointmentProfileContext));
router.post("/:id/notes", requireRole("admin", "consultant"), asyncHandler(createAppointmentNote));
router.post("/:id/follow-ups", requireRole("admin", "consultant"), asyncHandler(createAppointmentFollowUp));
router.post("/", asyncHandler(createAppointment));
router.patch("/:id", asyncHandler(updateAppointment));
router.delete("/:id", asyncHandler(deleteAppointment));

export default router;
