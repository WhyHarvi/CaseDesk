import prisma from "./prisma/client.js";
import { logger } from "./logger.js";
import { microsoftGraphClient, mailboxGrantsCalendarAccess } from "./microsoftMailboxService.js";

// Mirrors appointments onto Outlook calendars — a busy-block with the full
// client/case context in the body, never a meeting invite (no attendees are
// ever added, so nothing emails the client). One row per (appointment,
// viewer) in AppointmentCalendarSync, because "who should see this on their
// own calendar" isn't 1:1 with the appointment: the assigned staff member
// always gets one event, and an admin with calendar sync on gets one for
// EVERY appointment in the agency, not just their own.
//
// Reconciled by polling for appointments whose updatedAt has moved past a
// viewer's own syncedAt, rather than hooking the ~20 booking/reschedule/
// cancel call sites spread across bookingController/publicBookingController/
// lead.service/etc. — any mutation there already bumps updatedAt for free.
//
// The interval poll below is a safety net, not the primary freshness
// mechanism: scheduleImmediateOutlookCalendarSync (kicked from
// enqueueAppointmentMeetingJob, the one function every one of those ~20
// sites already calls) already syncs a fresh change within ~1.5s. That's
// why this runs every 10 minutes rather than every few seconds — a real
// booking never waits on this interval, so shortening it further only adds
// steady-state database load (a handful of queries per tick, every tick,
// for every agency using this feature, whether or not anything actually
// changed) without making anything feel more responsive.
const POLL_MS = 10 * 60_000;
const BATCH_SIZE = 50;
const MEETING_MODE_LABEL = { InPerson: "In person", Phone: "Phone call", Online: "Jitsi video call", Zoom: "Zoom video call" };
let timer = null;
let running = false;
let pendingImmediateSync = null;
// Long enough for the enclosing db.$transaction() most booking/reschedule/
// cancel call sites run inside (enqueueAppointmentMeetingJob is called from
// within it) to have committed by the time this fires, short enough to feel
// immediate rather than waiting for the next POLL_MS tick.
const IMMEDIATE_SYNC_DELAY_MS = 1_500;

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
    appointment.sessionType?.name ? `Consultation type: ${appointment.sessionType.name}` : null,
    `Format: ${MEETING_MODE_LABEL[appointment.meetingMode] || appointment.meetingMode || "In person"}`,
    appointment.assignedTo?.fullName ? `Assigned to: ${appointment.assignedTo.fullName}` : null,
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

// Creates or updates the mirrored event on one specific viewer's calendar.
export async function pushAppointmentToOutlookCalendar(viewerId, appointment, existingEventId) {
  const { request } = await microsoftGraphClient(viewerId);
  const payload = outlookEventPayload(appointment);
  if (existingEventId) {
    try {
      await request(`/me/events/${encodeURIComponent(existingEventId)}`, { method: "PATCH", body: JSON.stringify(payload) });
      return existingEventId;
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

export async function removeAppointmentFromOutlookCalendar(viewerId, eventId) {
  const { request } = await microsoftGraphClient(viewerId);
  try {
    await request(`/me/events/${encodeURIComponent(eventId)}`, { method: "DELETE" });
  } catch (error) {
    if (error.graphStatus !== 404) throw error;
  }
}

// Admins see every agency appointment on their own Outlook calendar, not
// just the ones assigned to them — everyone else only sees their own.
async function eligibleViewers(agencyIds) {
  const connections = await prisma.userMailboxConnection.findMany({
    where: { status: "connected", calendarSyncEnabled: true, agencyId: { in: agencyIds } },
    select: { userId: true, agencyId: true, grantedScopes: true, user: { select: { role: true } } },
  });
  return connections
    .filter((connection) => mailboxGrantsCalendarAccess(connection.grantedScopes))
    .map((connection) => ({ userId: connection.userId, agencyId: connection.agencyId, isAdmin: connection.user?.role === "admin" }));
}

const APPOINTMENT_INCLUDE = {
  client: { select: { fullName: true } },
  lead: { select: { firstName: true, lastName: true } },
  sessionType: { select: { name: true } },
  assignedTo: { select: { fullName: true } },
};

// A cutoff keeps a stray old "Scheduled" row from being dragged into an
// admin's full-agency scope forever — appointments normally transition to
// Completed/NoShow well before this.
function scheduledSinceCutoff() {
  return new Date(Date.now() - 24 * 60 * 60 * 1000);
}

async function dueAppointmentsForViewer(viewer) {
  const candidates = await prisma.appointment.findMany({
    where: {
      agencyId: viewer.agencyId,
      status: "Scheduled",
      startsAt: { gte: scheduledSinceCutoff() },
      ...(viewer.isAdmin ? {} : { assignedToId: viewer.userId }),
    },
    orderBy: { updatedAt: "asc" },
    take: BATCH_SIZE,
    include: APPOINTMENT_INCLUDE,
  });
  if (!candidates.length) return [];
  const syncRows = await prisma.appointmentCalendarSync.findMany({
    where: { userId: viewer.userId, appointmentId: { in: candidates.map((appointment) => appointment.id) } },
  });
  const syncByAppointmentId = new Map(syncRows.map((row) => [row.appointmentId, row]));
  return candidates
    .filter((appointment) => {
      const sync = syncByAppointmentId.get(appointment.id);
      return !sync || !sync.syncedAt || sync.syncedAt < appointment.updatedAt;
    })
    .map((appointment) => ({ appointment, sync: syncByAppointmentId.get(appointment.id) || null }));
}

async function dueDeletionsForViewer(viewer) {
  return prisma.appointmentCalendarSync.findMany({
    where: {
      userId: viewer.userId,
      calendarEventId: { not: null },
      appointment: { agencyId: viewer.agencyId, status: "Cancelled", ...(viewer.isAdmin ? {} : { assignedToId: viewer.userId }) },
    },
    take: BATCH_SIZE,
  });
}

async function syncOneForViewer(viewer, appointment, sync) {
  try {
    const eventId = await pushAppointmentToOutlookCalendar(viewer.userId, appointment, sync?.calendarEventId || null);
    await prisma.appointmentCalendarSync.upsert({
      where: { appointmentId_userId: { appointmentId: appointment.id, userId: viewer.userId } },
      create: { appointmentId: appointment.id, userId: viewer.userId, calendarEventId: eventId, syncStatus: "Synced", syncedAt: new Date() },
      update: { calendarEventId: eventId, syncStatus: "Synced", syncedAt: new Date(), syncError: null },
    });
  } catch (error) {
    // Deliberately does not set syncedAt on failure, so the next poll
    // retries automatically — except a mailbox reauth requirement, which
    // eligibleViewers already excludes up front, so this never busy-retries
    // a connection it knows is broken.
    await prisma.appointmentCalendarSync.upsert({
      where: { appointmentId_userId: { appointmentId: appointment.id, userId: viewer.userId } },
      create: { appointmentId: appointment.id, userId: viewer.userId, syncStatus: "Failed", syncError: String(error.message || error).slice(0, 500) },
      update: { syncStatus: "Failed", syncError: String(error.message || error).slice(0, 500) },
    }).catch(() => {});
    logger.warn("outlook_calendar.sync_failed", { appointmentId: appointment.id, viewerId: viewer.userId, reason: error.message });
  }
}

async function deleteOneForViewer(viewer, sync) {
  try {
    if (sync.calendarEventId) await removeAppointmentFromOutlookCalendar(viewer.userId, sync.calendarEventId);
    await prisma.appointmentCalendarSync.update({
      where: { id: sync.id },
      data: { calendarEventId: null, syncStatus: "Deleted", syncedAt: new Date(), syncError: null },
    });
  } catch (error) {
    logger.warn("outlook_calendar.delete_failed", { appointmentId: sync.appointmentId, viewerId: viewer.userId, reason: error.message });
  }
}

// Real numbers for the Settings panel — replaces a bare on/off badge that
// gave no way to tell "nothing has synced yet" apart from "everything's
// already caught up." "pending" reuses dueAppointmentsForViewer, the exact
// same query the poller itself runs next, so the count in the UI can never
// drift from what the poller will actually do.
export async function getOutlookCalendarSyncStats(userId) {
  const connection = await prisma.userMailboxConnection.findUnique({
    where: { userId },
    select: { agencyId: true, status: true, calendarSyncEnabled: true, grantedScopes: true, user: { select: { role: true } } },
  });
  const active = Boolean(connection?.status === "connected" && connection.calendarSyncEnabled && mailboxGrantsCalendarAccess(connection.grantedScopes));
  if (!active) return { active: false, scope: null, synced: 0, pending: 0, failed: 0, lastSyncedAt: null };

  const viewer = { userId, agencyId: connection.agencyId, isAdmin: connection.user?.role === "admin" };
  const [statusCounts, due, lastSynced] = await Promise.all([
    prisma.appointmentCalendarSync.groupBy({ by: ["syncStatus"], where: { userId }, _count: { _all: true } }),
    dueAppointmentsForViewer(viewer),
    prisma.appointmentCalendarSync.findFirst({ where: { userId, syncedAt: { not: null } }, orderBy: { syncedAt: "desc" }, select: { syncedAt: true } }),
  ]);
  const countFor = (status) => statusCounts.find((row) => row.syncStatus === status)?._count?._all || 0;
  return {
    active: true,
    scope: viewer.isAdmin ? "agency" : "own",
    synced: countFor("Synced"),
    pending: due.length,
    failed: countFor("Failed"),
    lastSyncedAt: lastSynced?.syncedAt || null,
  };
}

export async function processPendingOutlookCalendarSyncs() {
  if (running) return;
  running = true;
  try {
    const agencies = await prisma.userMailboxConnection.findMany({ where: { status: "connected" }, select: { agencyId: true }, distinct: ["agencyId"] });
    if (!agencies.length) return;
    const viewers = await eligibleViewers(agencies.map((row) => row.agencyId));
    for (const viewer of viewers) {
      const due = await dueAppointmentsForViewer(viewer);
      for (const { appointment, sync } of due) await syncOneForViewer(viewer, appointment, sync);
      const dueDeletions = await dueDeletionsForViewer(viewer);
      for (const sync of dueDeletions) await deleteOneForViewer(viewer, sync);
    }
  } catch (error) {
    logger.warn("outlook_calendar.worker_failed", { reason: error.message });
  } finally {
    running = false;
  }
}

// Called from enqueueAppointmentMeetingJob — the one function every
// booking/reschedule/cancel call site already goes through — so a fresh
// change gets picked up within ~1.5s instead of waiting for the next poll.
// Debounced to one pending timer: several mutations in quick succession
// (e.g. a recurring series) still only trigger one extra sync pass.
export function scheduleImmediateOutlookCalendarSync() {
  if (pendingImmediateSync) return;
  pendingImmediateSync = setTimeout(() => {
    pendingImmediateSync = null;
    void processPendingOutlookCalendarSyncs();
  }, IMMEDIATE_SYNC_DELAY_MS);
  if (pendingImmediateSync.unref) pendingImmediateSync.unref();
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
  if (pendingImmediateSync) clearTimeout(pendingImmediateSync);
  pendingImmediateSync = null;
}
