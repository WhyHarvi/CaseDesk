import { Router } from "express";
import { createAppointment, deleteAppointment, listCaseAppointments, updateAppointment } from "../controllers/appointmentController.js";
import { asyncHandler } from "../utils/http.js";

const router = Router();
router.get("/case/:caseId", asyncHandler(listCaseAppointments));
router.post("/", asyncHandler(createAppointment));
router.patch("/:id", asyncHandler(updateAppointment));
router.delete("/:id", asyncHandler(deleteAppointment));

export default router;
