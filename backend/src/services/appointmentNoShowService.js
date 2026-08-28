import prisma from "./prisma/client.js";
import { logger } from "./logger.js";
import { reportingBounds } from "../modules/leads/lead.metrics.js";
import { applyAppointmentStatusChange } from "../controllers/bookingController.js";

// If a consultant never marks an appointment attended/no-show, it would
// otherwise sit in "Scheduled" forever — nobody is forced to resolve it, and
// it keeps counting toward that day's stats indefinitely. Once an
// appointment's calendar day (in its own agency's timezone) has fully
// elapsed without a decision, it's automatically marked NoShow. Runs through
// applyAppointmentStatusChange — the same function the manual "mark
// no-show" button uses — so this gets every side effect a human-triggered
// no-show gets (payment-hold voiding included), with nothing to drift out
// of sync between the two paths.
// The threshold itself is a full calendar day, so checking every 30 minutes
// vs. every hour makes no practical difference to when this fires — the
// worst case just shifts from "up to 30 minutes after the day fully
// elapsed" to "up to 60 minutes after."
const NO_SHOW_POLL_MS = Math.max(Number(process.env.APPOINTMENT_NO_SHOW_POLL_MS) || 60 * 60_000, 60_000);
let noShowPollTimer = null;
let noShowPollRunning = false;

export async function autoMarkNoShowAppointments() {
  if (noShowPollRunning) return 0;
  noShowPollRunning = true;
  try {
    const now = new Date();
    const agencies = await prisma.agency.findMany({ select: { id: true, timezone: true } });
    let markedCount = 0;
    for (const agency of agencies) {
      const { todayStart } = reportingBounds(now, agency.timezone || "America/Toronto");
      const overdue = await prisma.appointment.findMany({
        where: { agencyId: agency.id, status: "Scheduled", startsAt: { lt: todayStart } },
        take: 200,
      });
      for (const appointment of overdue) {
        try {
          await applyAppointmentStatusChange({
            agencyId: agency.id,
            existing: appointment,
            status: "NoShow",
            actorUserId: null,
            reason: null,
          });
          markedCount += 1;
        } catch (error) {
          logger.warn("appointment.auto_no_show_failed", { agencyId: agency.id, appointmentId: appointment.id, reason: error.message });
        }
      }
    }
    return markedCount;
  } finally {
    noShowPollRunning = false;
  }
}

export function startAppointmentNoShowWorker() {
  if (noShowPollTimer) return;
  noShowPollTimer = setInterval(() => {
    autoMarkNoShowAppointments().catch((error) => logger.warn("appointment.auto_no_show_pass_failed", { reason: error.message }));
  }, NO_SHOW_POLL_MS);
  if (noShowPollTimer.unref) noShowPollTimer.unref();
}

export function stopAppointmentNoShowWorker() {
  if (noShowPollTimer) clearInterval(noShowPollTimer);
  noShowPollTimer = null;
}
