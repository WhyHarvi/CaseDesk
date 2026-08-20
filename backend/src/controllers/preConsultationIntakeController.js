import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { recordAppointmentEvent } from "../services/appointmentOperationsService.js";
import {
  getManagedPreConsultationAppointment,
  PRE_CONSULTATION_EVENT,
} from "../services/preConsultationIntakeService.js";
import { savePreConsultationSubmission } from "../services/preConsultationSubmissionService.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function contactFor(appointment) {
  const leadName = [appointment.lead?.firstName, appointment.lead?.lastName].filter(Boolean).join(" ").trim();
  return {
    name: appointment.guestName || appointment.client?.fullName || leadName || "Client",
    email: appointment.guestEmail || appointment.client?.email || appointment.lead?.email || null,
    phone: appointment.guestPhone || appointment.client?.phone || appointment.lead?.phone || null,
  };
}

export async function getPreConsultationIntake(req, res) {
  const appointment = await getManagedPreConsultationAppointment(req.params.manageToken);
  if (!appointment || appointment.status !== "Scheduled") throw createHttpError(404, "This questionnaire is not available.", "INTAKE_NOT_FOUND");

  const events = await prisma.appointmentEvent.findMany({
    where: { appointmentId: appointment.id, type: { in: [PRE_CONSULTATION_EVENT.OPENED, PRE_CONSULTATION_EVENT.SUBMITTED] } },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  const submission = events.find((event) => event.type === PRE_CONSULTATION_EVENT.SUBMITTED);
  if (!events.some((event) => event.type === PRE_CONSULTATION_EVENT.OPENED)) {
    await recordAppointmentEvent(prisma, {
      agencyId: appointment.agencyId,
      appointmentId: appointment.id,
      type: PRE_CONSULTATION_EVENT.OPENED,
      summary: "Pre-consultation questionnaire opened",
      metadata: { questionnaireVersion: 1 },
    });
  }
  const contact = contactFor(appointment);
  res.json({
    data: {
      agency: { name: appointment.agency.legalName || appointment.agency.name, logoUrl: appointment.agency.logoUrl || null },
      appointment: {
        subject: appointment.subject,
        startsAt: appointment.startsAt,
        timezone: appointment.bookingSettings?.timezone || "America/Toronto",
        sessionType: appointment.sessionType?.name || null,
      },
      contact: { name: contact.name, email: contact.email && EMAIL_PATTERN.test(contact.email) ? contact.email : null, phone: contact.phone },
      status: submission ? "Submitted" : "Open",
      submittedAt: submission?.createdAt || null,
      questionnaireVersion: 1,
    },
  });
}

export async function submitPreConsultationIntake(req, res) {
  const appointment = await getManagedPreConsultationAppointment(req.params.manageToken);
  if (!appointment || appointment.status !== "Scheduled") throw createHttpError(404, "This questionnaire is not available.", "INTAKE_NOT_FOUND");
  if (new Date(appointment.startsAt).getTime() + 24 * 60 * 60_000 < Date.now()) {
    throw createHttpError(410, "This questionnaire has expired. Please contact the agency if you still need to provide information.", "INTAKE_EXPIRED");
  }

  const result = await savePreConsultationSubmission(prisma, {
    appointment,
    body: req.body || {},
    source: "client",
    requireConsent: true,
    allowResubmit: false,
  });

  if (result.alreadySubmitted) {
    return res.json({ data: { submitted: true, submittedAt: result.event.createdAt, alreadySubmitted: true } });
  }

  res.status(201).json({
    data: {
      submitted: true,
      submittedAt: result.event.createdAt,
      flagsRecorded: result.flags.length,
      message: "Thank you. Your information has been sent securely to your consultation team.",
    },
  });
}
