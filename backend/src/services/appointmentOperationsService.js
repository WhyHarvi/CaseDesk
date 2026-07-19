import { randomBytes } from "node:crypto";

export function appointmentReference() {
  return `APT-${randomBytes(4).toString("hex").toUpperCase()}`;
}

export async function recordAppointmentEvent(tx, {
  agencyId,
  appointmentId,
  actorUserId = null,
  type,
  summary,
  metadata = {},
}) {
  if (!tx.appointmentEvent) return null;
  return tx.appointmentEvent.create({
    data: { agencyId, appointmentId, actorUserId, type, summary, metadata },
  });
}

export function recurrenceStarts(start, recurrence = null) {
  if (!recurrence || recurrence.frequency === "NONE") return [new Date(start)];
  const count = Math.min(Math.max(Number(recurrence.count) || 1, 1), 52);
  const stepDays = recurrence.frequency === "DAILY" ? 1 : recurrence.frequency === "WEEKLY" ? 7 : recurrence.frequency === "MONTHLY" ? null : 0;
  if (stepDays === 0) return [new Date(start)];
  const dates = [];
  for (let index = 0; index < count; index += 1) {
    const next = new Date(start);
    if (stepDays == null) next.setUTCMonth(next.getUTCMonth() + index);
    else next.setUTCDate(next.getUTCDate() + index * stepDays);
    dates.push(next);
  }
  return dates;
}

export const DEFAULT_BOOKING_TEMPLATES = Object.freeze({
  booked: { subject: "Appointment confirmed", intro: "Your appointment has been reserved. We look forward to meeting you." },
  reminder: { subject: "Appointment reminder", intro: "A friendly reminder about your upcoming appointment." },
  rescheduled: { subject: "Appointment rescheduled", intro: "Your appointment has been moved to the new date and time below." },
  cancelled: { subject: "Appointment cancelled", intro: "This appointment is no longer scheduled." },
  waitlist: { subject: "An appointment time is available", intro: "A time matching your waitlist request has opened." },
});
