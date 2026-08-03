export function leadConsultationAppointmentType(meetingMode) {
  if (meetingMode === "Phone") return "PHONE";
  if (meetingMode === "Online") return "JITSI";
  if (meetingMode === "Zoom") return "ZOOM";
  return "IN_PERSON";
}

export function leadConsultationStatusForAppointment(status) {
  if (status === "Completed") return "COMPLETED";
  if (status === "Cancelled") return "CANCELLED";
  if (status === "NoShow") return "NO_SHOW";
  return "SCHEDULED";
}

const LEAD_ACTIVITY_BY_CONSULTATION_STATUS = Object.freeze({
  RESCHEDULED: {
    activityType: "CONSULTATION_RESCHEDULED",
    title: "Consultation rescheduled",
  },
  COMPLETED: {
    activityType: "CONSULTATION_COMPLETED",
    title: "Consultation completed",
  },
  CANCELLED: {
    activityType: "CONSULTATION_CANCELLED",
    title: "Consultation cancelled",
  },
  NO_SHOW: {
    activityType: "CONSULTATION_NO_SHOW",
    title: "Consultation marked no-show",
  },
});

function consultationActivityOccurredAt(appointment, consultationStatus) {
  if (consultationStatus === "CANCELLED" && appointment.cancelledAt) {
    return new Date(appointment.cancelledAt);
  }
  return new Date(appointment.updatedAt || Date.now());
}

async function recordLeadConsultationActivity(db, appointment, consultation, consultationStatus) {
  const activity = LEAD_ACTIVITY_BY_CONSULTATION_STATUS[consultationStatus];
  if (!activity || !db?.leadActivity?.findFirst || !db?.leadActivity?.create) return;

  const agencyId = consultation?.agencyId || appointment.agencyId;
  const leadId = consultation?.leadId || appointment.leadId;
  if (!agencyId || !leadId) return;

  const occurredAt = consultationActivityOccurredAt(appointment, consultationStatus);
  const externalId = `appointment:${appointment.id}:consultation:${consultationStatus.toLowerCase()}:${occurredAt.toISOString()}`;
  const existing = await db.leadActivity.findFirst({
    where: { agencyId, leadId, externalId },
    select: { id: true },
  });
  if (existing) return;

  await db.leadActivity.create({
    data: {
      agencyId,
      leadId,
      activityType: activity.activityType,
      direction: "INTERNAL",
      channel: "SYSTEM",
      title: activity.title,
      description: consultationStatus === "CANCELLED" ? appointment.cancellationReason || null : null,
      performedById: consultationStatus === "CANCELLED" ? appointment.cancelledById || null : null,
      externalId,
      occurredAt,
      metadata: {
        appointmentId: appointment.id,
        ...(consultation?.id ? { consultationId: consultation.id } : {}),
        status: consultationStatus,
      },
    },
  });
}

/**
 * Appointment is the scheduling source of truth. LeadConsultation keeps
 * commercial/workflow context, but its scheduling snapshot must follow the
 * linked appointment whenever Calendar, the public manage link, or Zoom
 * changes it.
 */
export async function syncLeadConsultationFromAppointment(db, appointment, {
  consultationStatus = null,
  recordLeadActivity = true,
} = {}) {
  if (!appointment?.id || !appointment?.startsAt || !appointment?.endsAt || !db?.leadConsultation?.updateMany) return 0;
  const consultation = typeof db.leadConsultation.findFirst === "function"
    ? await db.leadConsultation.findFirst({
      where: { appointmentId: appointment.id },
      select: { id: true, agencyId: true, leadId: true, outcome: true },
    })
    : null;
  // The DB enforces that a COMPLETED consultation has an outcome
  // (lead_consultations_completion_check) — outcome is a business decision
  // only the lead workflow's own "complete consultation" action collects
  // (lead.validation.js requires it there too). A blind appointment-status
  // mirror — e.g. Calendar's "Mark attended", which has no outcome picker —
  // must not push status: COMPLETED here without one, or this throws.
  // Skipping it just leaves the consultation's status for that workflow to
  // set once an outcome is actually recorded; the appointment itself still
  // updates fine either way.
  const canApplyStatus = consultationStatus !== "COMPLETED" || Boolean(consultation?.outcome);
  const result = await db.leadConsultation.updateMany({
    where: { appointmentId: appointment.id },
    data: {
      startAt: new Date(appointment.startsAt),
      endAt: new Date(appointment.endsAt),
      appointmentType: leadConsultationAppointmentType(appointment.meetingMode),
      location: appointment.meetingMode === "InPerson" ? appointment.location : null,
      meetingUrl: appointment.meetingUrl || null,
      ...(consultationStatus && canApplyStatus ? { status: consultationStatus } : {}),
    },
  });
  if (consultationStatus && canApplyStatus && recordLeadActivity) {
    await recordLeadConsultationActivity(db, appointment, consultation, consultationStatus);
  }
  return result.count;
}
