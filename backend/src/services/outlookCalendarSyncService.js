import { Prisma } from "@prisma/client";
import prisma from "./prisma/client.js";
import { logger } from "./logger.js";
import { microsoftGraphClient, mailboxGrantsCalendarAccess } from "./microsoftMailboxService.js";

// One-way mirror of CaseDesk appointments onto the assigned staff member's
// own Outlook calendar — a busy-block on their personal calendar, never a
// meeting invite sent to the client (no attendees are added). Reconciled by
// polling for appointments whose updatedAt has moved past calendarSyncedAt,
// rather than hooking the ~20 booking/reschedule/cancel call sites spread
// across bookingController/publicBookingController/lead.service/etc. — any
// mutation there already bumps updatedAt for free, so this needs no changes
// there at all.
const POLL_MS = 30_000;
const BATCH_SIZE = 25;
let timer = null;
let running = false;

function graphDateTime(value) {
  // Graph's dateTimeTimeZone resource wants a plain local datetime string
  // with the zone given separately — passing "UTC" here means the ISO
  // string (already UTC) can be used as-is, just without the trailing "Z"
  // Graph doesn't want on this field.
  return { dateTime: new Date(value).toISOString().replace("Z", ""), timeZone: "UTC" };
}

function appointmentPersonName(appointment) {
  if (appointment.client?.fullName) return appointment.client.fullName;
  const leadName = [appointment.lead?.firstName, appointment.lead?.lastName].filter(Boolean).join(" ");
  if (leadName) return leadName;
  return appointment.guestName || null;
}

function outlookEventPayload(appointment) {
  const personName = appointmentPersonName(appointment);
  const subject = [appointment.subject || "Appointment", personName].filter(Boolean).join(" — ");
  const bodyLines = [
    `CaseDesk appointment ${appointment.referenceCode || appointment.id}`,
    personName ? `With: ${personName}` : null,
    appointment.purpose || appointment.description || null,
  ].filter(Boolean);
  return {
    subject: subject.slice(0, 250),
    body: { contentType: "text", content: bodyLines.join("\n") },
    start: graphDateTime(appointment.startsAt),
    end: graphDateTime(appointment.endsAt),
    ...(appointment.location ? { location: { displayName: appointment.location.slice(0, 250) } } : {}),
    isReminderOn: false,
  };
}

// Creates or updates the mirrored event. Callers decide whether an
// appointment is currently eligible (Scheduled, assigned to a user with a
// calendar-scoped mailbox) — this function only does the Graph call.
export async function pushAppointmentToOutlookCalendar(appointment) {
  const { request } = await microsoftGraphClient(appointment.assignedToId);
  const payload = outlookEventPayload(appointment);
  if (appointment.calendarEventId) {
    try {
      await request(`/me/events/${encodeURIComponent(appointment.calendarEventId)}`, { method: "PATCH", body: JSON.stringify(payload) });
      return appointment.calendarEventId;
    } catch (error) {
      // The event may have been deleted on the Outlook side directly (the
      // person cleaned up their own calendar) — Graph 404s a PATCH to a
      // gone event. Fall through and recreate rather than treating that as
      // a hard failure.
      if (error.graphStatus !== 404) throw error;
    }
  }
  const created = await request("/me/events", { method: "POST", body: JSON.stringify(payload) });
  return created.id;
}

export async function removeAppointmentFromOutlookCalendar(appointment) {
  const { request } = await microsoftGraphClient(appointment.assignedToId);
  try {
    await request(`/me/events/${encodeURIComponent(appointment.calendarEventId)}`, { method: "DELETE" });
  } catch (error) {
    if (error.graphStatus !== 404) throw error;
  }
}

async function eligibleAssigneeIds(agencyIds) {
  const connections = await prisma.userMailboxConnection.findMany({
    where: { status: "connected", agencyId: { in: agencyIds } },
    select: { userId: true, grantedScopes: true },
  });
  return connections.filter((connection) => mailboxGrantsCalendarAccess(connection.grantedScopes)).map((connection) => connection.userId);
}

async function syncOne(appointment) {
  try {
    if (appointment.status === "Cancelled") {
      if (appointment.calendarEventId) await removeAppointmentFromOutlookCalendar(appointment);
      await prisma.appointment.update({
        where: { id: appointment.id },
        data: { calendarSyncStatus: "Deleted", calendarSyncedAt: new Date(), calendarEventId: null, calendarSyncError: null },
      });
      return;
    }
    const eventId = await pushAppointmentToOutlookCalendar(appointment);
    await prisma.appointment.update({
      where: { id: appointment.id },
      data: { calendarSyncStatus: "Synced", calendarSyncedAt: new Date(), calendarEventId: eventId, calendarSyncError: null },
    });
  } catch (error) {
    // Deliberately does not bump calendarSyncedAt on failure, so the next
    // poll retries automatically — except a mailbox reauth requirement,
    // which eligibleAssigneeIds already excludes up front, so this file
    // never busy-retries a connection it knows is broken.
    await prisma.appointment.update({
      where: { id: appointment.id },
      data: { calendarSyncStatus: "Failed", calendarSyncError: String(error.message || error).slice(0, 500) },
    }).catch(() => {});
    logger.warn("outlook_calendar.sync_failed", { appointmentId: appointment.id, reason: error.message });
  }
}

export async function processPendingOutlookCalendarSyncs() {
  if (running) return;
  running = true;
  try {
    const agencies = await prisma.userMailboxConnection.findMany({ where: { status: "connected" }, select: { agencyId: true }, distinct: ["agencyId"] });
    if (!agencies.length) return;
    const agencyIds = agencies.map((row) => row.agencyId);
    const assigneeIds = await eligibleAssigneeIds(agencyIds);
    if (!assigneeIds.length) return;

    // "Needs a (re)sync" is calendar_synced_at < updated_at — a column-to-
    // column comparison Prisma's query builder can't express, so the id
    // lookup goes through a raw query (parameterized via Prisma.sql, same
    // pattern as workload.report.service.js) and the actual fetch (with its
    // includes) stays a normal Prisma call.
    const dueIds = await prisma.$queryRaw(Prisma.sql`
      SELECT "id" FROM "appointments"
      WHERE "agency_id" IN (${Prisma.join(agencyIds)})
        AND "assigned_to_id" IN (${Prisma.join(assigneeIds)})
        AND "status" = 'Scheduled'
        AND ("calendar_synced_at" IS NULL OR "calendar_synced_at" < "updated_at")
      ORDER BY "updated_at" ASC
      LIMIT ${BATCH_SIZE}
    `);
    const dueForPush = dueIds.length
      ? await prisma.appointment.findMany({
          where: { id: { in: dueIds.map((row) => row.id) } },
          include: { client: { select: { fullName: true } }, lead: { select: { firstName: true, lastName: true } } },
        })
      : [];
    const dueForDeletion = await prisma.appointment.findMany({
      where: {
        agencyId: { in: agencyIds },
        assignedToId: { in: assigneeIds },
        status: "Cancelled",
        calendarEventId: { not: null },
      },
      take: BATCH_SIZE,
    });
    for (const appointment of [...dueForPush, ...dueForDeletion]) {
      await syncOne(appointment);
    }
  } catch (error) {
    logger.warn("outlook_calendar.worker_failed", { reason: error.message });
  } finally {
    running = false;
  }
}

export function startOutlookCalendarSyncWorker() {
  if (timer) return;
  timer = setInterval(() => {
    void processPendingOutlookCalendarSyncs();
  }, POLL_MS);
  void processPendingOutlookCalendarSyncs();
  if (timer.unref) timer.unref();
}

export function stopOutlookCalendarSyncWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}
