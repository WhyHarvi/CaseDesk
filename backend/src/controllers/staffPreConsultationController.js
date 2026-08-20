import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { appointmentProfileAccessWhere } from "../services/appointmentProfileService.js";
import {
  deliverPreConsultationIntake,
  preConsultationAppointmentInclude,
} from "../services/preConsultationIntakeService.js";
import { savePreConsultationSubmission } from "../services/preConsultationSubmissionService.js";

async function getStaffAppointment(req) {
  const appointment = await prisma.appointment.findFirst({
    where: {
      id: req.params.id,
      agencyId: req.auth.agencyId,
      ...appointmentProfileAccessWhere(req),
    },
    include: preConsultationAppointmentInclude,
  });
  if (!appointment) throw createHttpError(404, "Appointment not found.", "NOT_FOUND");
  if (appointment.status !== "Scheduled") {
    throw createHttpError(400, "Pre-consultation information can only be collected for a scheduled appointment.", "INVALID_APPOINTMENT_STATUS");
  }
  if (!appointment.manageToken) {
    throw createHttpError(400, "This appointment does not have a secure questionnaire link.", "INTAKE_LINK_UNAVAILABLE");
  }
  return appointment;
}

export async function sendPreConsultationManually(req, res) {
  const appointment = await getStaffAppointment(req);
  const event = await deliverPreConsultationIntake(appointment, {
    force: true,
    actorUserId: req.auth.userId,
  });
  const metadata = event?.metadata && typeof event.metadata === "object" ? event.metadata : {};
  res.json({
    data: {
      sent: event?.type === "PRE_CONSULTATION_INTAKE_SENT",
      eventType: event?.type || null,
      emailStatus: metadata.emailStatus || null,
      smsStatus: metadata.smsStatus || null,
      sentAt: event?.createdAt || null,
    },
  });
}

export async function savePreConsultationManually(req, res) {
  const appointment = await getStaffAppointment(req);
  const result = await savePreConsultationSubmission(prisma, {
    appointment,
    body: req.body || {},
    actorUserId: req.auth.userId,
    source: "staff_manual",
    requireConsent: false,
    allowResubmit: true,
  });
  res.status(201).json({
    data: {
      submitted: true,
      submittedAt: result.event.createdAt,
      flagsRecorded: result.flags.length,
      source: "staff_manual",
    },
  });
}
