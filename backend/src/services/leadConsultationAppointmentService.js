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

/**
 * Appointment is the scheduling source of truth. LeadConsultation keeps
 * commercial/workflow context, but its scheduling snapshot must follow the
 * linked appointment whenever Calendar, the public manage link, or Zoom
 * changes it.
 */
export async function syncLeadConsultationFromAppointment(db, appointment, {
  consultationStatus = null,
} = {}) {
  if (!appointment?.id || !appointment?.startsAt || !appointment?.endsAt || !db?.leadConsultation?.updateMany) return 0;
  const result = await db.leadConsultation.updateMany({
    where: { appointmentId: appointment.id },
    data: {
      startAt: new Date(appointment.startsAt),
      endAt: new Date(appointment.endsAt),
      appointmentType: leadConsultationAppointmentType(appointment.meetingMode),
      location: appointment.meetingMode === "InPerson" ? appointment.location : null,
      meetingUrl: appointment.meetingUrl || null,
      ...(consultationStatus ? { status: consultationStatus } : {}),
    },
  });
  return result.count;
}
