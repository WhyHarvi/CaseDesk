import prisma from "../services/prisma/client.js";
import { createHttpError } from "../utils/http.js";
import { requireAppointmentProfile } from "../services/appointmentProfileService.js";
import {
  deliverPreConsultationIntake,
  PRE_CONSULTATION_EVENT,
  preConsultationAppointmentInclude,
} from "../services/preConsultationIntakeService.js";
import { buildPreConsultationHighlights, derivePreConsultationFlags, savePreConsultationSubmission } from "../services/preConsultationSubmissionService.js";
import { summarizePreConsultationIntake } from "../services/ollama.service.js";
import { logger } from "../services/logger.js";
import { recordAppointmentEvent } from "../services/appointmentOperationsService.js";

function contactFor(appointment) {
  const leadName = [appointment.lead?.firstName, appointment.lead?.lastName].filter(Boolean).join(" ").trim();
  return {
    name: appointment.guestName || appointment.client?.fullName || leadName || "Client",
    email: appointment.guestEmail || appointment.client?.email || appointment.lead?.email || null,
    phone: appointment.guestPhone || appointment.client?.phone || appointment.lead?.phone || null,
  };
}

async function authorizedAppointment(req) {
  const profile = await requireAppointmentProfile(req, req.params.id);
  const appointment = await prisma.appointment.findFirst({
    where: { id: profile.id, agencyId: req.auth.agencyId },
    include: preConsultationAppointmentInclude,
  });
  if (!appointment) throw createHttpError(404, "Appointment not found.", "NOT_FOUND");
  return { profile, appointment };
}

export async function getStaffPreConsultationIntake(req, res) {
  const { profile, appointment } = await authorizedAppointment(req);
  const contact = contactFor(appointment);
  res.json({
    data: {
      ...(profile.preConsultationIntake || {}),
      appointmentId: appointment.id,
      agency: {
        name: appointment.agency.legalName || appointment.agency.name,
        logoUrl: appointment.agency.logoUrl || null,
      },
      appointment: {
        id: appointment.id,
        subject: appointment.subject,
        startsAt: appointment.startsAt,
        status: appointment.status,
        timezone: appointment.agency.bookingSettings?.timezone || "America/Toronto",
        sessionType: appointment.sessionType?.name || null,
      },
      contact,
      staffMode: true,
    },
  });
}

export async function sendStaffPreConsultationIntake(req, res) {
  const { profile, appointment } = await authorizedAppointment(req);
  if (appointment.status !== "Scheduled") {
    throw createHttpError(409, "Only scheduled appointments can receive a pre-consultation questionnaire.", "APPOINTMENT_NOT_SCHEDULED");
  }
  if (!appointment.manageToken) {
    throw createHttpError(409, "This appointment does not have a questionnaire link.", "INTAKE_LINK_UNAVAILABLE");
  }
  if (profile.preConsultationIntake?.status === "Submitted") {
    throw createHttpError(409, "The questionnaire has already been submitted.", "INTAKE_ALREADY_SUBMITTED");
  }

  const event = await deliverPreConsultationIntake(appointment, {
    force: true,
    actorUserId: req.auth.userId,
  });
  const details = event?.metadata && typeof event.metadata === "object" ? event.metadata : {};
  const sentSomething = details.emailStatus === "sent" || details.smsStatus === "sent";
  if (!sentSomething) {
    throw createHttpError(502, details.emailError || details.smsError || "The questionnaire could not be delivered.", "INTAKE_DELIVERY_FAILED");
  }

  res.json({
    data: {
      sent: true,
      emailStatus: details.emailStatus || null,
      smsStatus: details.smsStatus || null,
      sentAt: event.createdAt,
    },
  });
}

export async function saveStaffPreConsultationIntake(req, res) {
  const { appointment } = await authorizedAppointment(req);
  if (!["Scheduled", "Completed"].includes(appointment.status)) {
    throw createHttpError(409, "Pre-consultation information cannot be edited for this appointment.", "INTAKE_NOT_EDITABLE");
  }

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

// Flags are recomputed fresh here (derivePreConsultationFlags runs its own
// date math against right now) rather than trusting the flags array stored
// at submission time, which freezes days_from_today as of whenever the
// client submitted — a flag that was "expires in 60 days" at submission
// reads as stale, or an already-expired status that was outside the
// original 90-day window never got flagged at all otherwise. Nova's
// narrative summary is best-effort: a failure here still returns the real
// flags, just without the prose, so nothing gets hidden behind an
// unavailable local model.
export async function getStaffPreConsultationSummary(req, res) {
  const { profile, appointment } = await authorizedAppointment(req);
  const answers = profile.preConsultationIntake?.answers;
  if (!answers) throw createHttpError(404, "No pre-consultation information has been submitted for this appointment.", "INTAKE_NOT_SUBMITTED");

  const flags = derivePreConsultationFlags(answers);
  const retainedSummary = profile.preConsultationIntake?.novaSummary || null;
  const regenerate = req.body?.regenerate === true;
  if (retainedSummary && !regenerate) {
    return res.json({ data: { flags, ...retainedSummary, retained: true, summaryError: null } });
  }

  let summary = null;
  let summaryError = null;
  const highlights = buildPreConsultationHighlights(flags, answers);
  try {
    summary = await summarizePreConsultationIntake({ flags, answers });
    const event = await recordAppointmentEvent(prisma, {
      agencyId: req.auth.agencyId,
      appointmentId: appointment.id,
      actorUserId: req.auth.userId,
      type: PRE_CONSULTATION_EVENT.SUMMARY_GENERATED,
      summary: regenerate ? "Nova pre-consultation summary regenerated" : "Nova pre-consultation summary generated",
      metadata: { summary, highlights },
    });
    return res.json({ data: { flags, summary, highlights, generatedAt: event.createdAt, retained: false, summaryError: null } });
  } catch (error) {
    summaryError = error.message || "The AI summary is unavailable right now.";
    logger.warn("pre_consultation.summary_failed", { agencyId: req.auth.agencyId, appointmentId: appointment.id, reason: error.message });
  }

  res.json({
    data: retainedSummary
      ? { flags, ...retainedSummary, retained: true, summaryError }
      : { flags, summary, highlights, generatedAt: null, retained: false, summaryError },
  });
}
