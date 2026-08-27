import prisma from "./prisma/client.js";
import { applyAppointmentStatusChange } from "../controllers/bookingController.js";

export const MINIMUM_ATTENDED_CALL_SECONDS = 30;

function started(appointment, now, allowBeforeStartMinutes) {
  return new Date(appointment.startsAt).getTime() - allowBeforeStartMinutes * 60_000 <= now.getTime();
}

// All inferred attendance signals come through this guard. The expectedStatus
// claim in applyAppointmentStatusChange makes competing signals harmless: the
// first one completes the appointment and later ones simply return false.
export async function autoMarkAppointmentAttended({
  agencyId,
  appointmentId,
  actorUserId = null,
  source,
  now = new Date(),
  requireAssignedActor = true,
  metadata = {},
  allowBeforeStartMinutes = 0,
}) {
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, agencyId },
  });
  if (!appointment || appointment.status !== "Scheduled" || !started(appointment, now, allowBeforeStartMinutes)) return false;
  if (requireAssignedActor && (!actorUserId || appointment.assignedToId !== actorUserId)) return false;

  const completed = await applyAppointmentStatusChange({
    agencyId,
    existing: appointment,
    status: "Completed",
    actorUserId,
    expectedStatus: "Scheduled",
    attendanceSource: source,
    attendanceMetadata: metadata,
  });
  if (!completed) return false;

  return true;
}

export async function autoMarkPhoneAppointmentFromCall(session) {
  if (session?.provider !== "TWILIO" || session.status !== "COMPLETED") return false;
  if (!session.handledByUserId || Number(session.durationSeconds || 0) < MINIMUM_ATTENDED_CALL_SECONDS) return false;

  const answeredAt = session.answeredAt ? new Date(session.answeredAt) : null;
  if (!answeredAt) return false;
  const earliest = new Date(answeredAt.getTime() - 30 * 60_000);
  const latest = new Date(answeredAt.getTime() + 2 * 60 * 60_000);
  const contactScope = [
    session.clientId ? { clientId: session.clientId } : null,
    session.caseId ? { caseId: session.caseId } : null,
    session.leadId ? { leadId: session.leadId } : null,
  ].filter(Boolean);
  if (!contactScope.length) return false;

  const candidates = await prisma.appointment.findMany({
    where: {
      agencyId: session.agencyId,
      assignedToId: session.handledByUserId,
      status: "Scheduled",
      meetingMode: "Phone",
      startsAt: { gte: earliest, lte: latest },
      OR: contactScope,
    },
    orderBy: { startsAt: "asc" },
    take: 2,
  });
  // Ambiguous call evidence must stay scheduled for human review.
  if (candidates.length !== 1) return false;
  return autoMarkAppointmentAttended({
    agencyId: session.agencyId,
    appointmentId: candidates[0].id,
    actorUserId: session.handledByUserId,
    source: "Twilio consultation call connected for at least 30 seconds",
    now: answeredAt,
    allowBeforeStartMinutes: 15,
    metadata: { callSessionId: session.id, durationSeconds: session.durationSeconds },
  });
}
