import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("an appointment mirrors onto its assigned staff member's Outlook calendar, and separately onto every admin's calendar too — one row per (appointment, viewer), never a meeting invite to the client", async () => {
  const [schema, migration, service] = await Promise.all([
    source("../prisma/schema.prisma"),
    source("../prisma/migrations/20260828180000_appointment_calendar_sync_per_viewer/migration.sql"),
    source("../src/services/outlookCalendarSyncService.js"),
  ]);
  assert.match(schema, /model AppointmentCalendarSync \{/);
  assert.match(schema, /@@unique\(\[appointmentId, userId\]\)/);
  // The old single-column-on-Appointment model couldn't represent "this same
  // appointment, mirrored onto two different people's calendars" — an admin
  // and the assigned staff member need independent event ids/sync state.
  const appointmentModel = schema.slice(schema.indexOf("model Appointment {"), schema.indexOf('@@map("appointments")'));
  assert.doesNotMatch(appointmentModel, /calendarEventId|calendarSyncStatus|calendarSyncedAt|calendarSyncError/);
  assert.match(appointmentModel, /calendarSyncs\s+AppointmentCalendarSync\[\]/);
  assert.match(migration, /DROP COLUMN "calendar_event_id"/);
  assert.match(migration, /CREATE TABLE "appointment_calendar_syncs"/);

  assert.match(service, /import \{ microsoftGraphClient, mailboxGrantsCalendarAccess \} from "\.\/microsoftMailboxService\.js";/);
  // Every event is created via the VIEWER's own delegated token (never the
  // agency system mailbox), and never with attendees — that would silently
  // email the client a Microsoft invite outside CaseDesk's own guarded
  // notification system.
  assert.match(service, /export async function pushAppointmentToOutlookCalendar\(viewerId, appointment, existingEventId\)/);
  assert.match(service, /microsoftGraphClient\(viewerId\)/);
  const payloadFn = service.slice(service.indexOf("function outlookEventPayload"), service.indexOf("// Creates or updates the mirrored event"));
  assert.doesNotMatch(payloadFn, /attendees/i);
  // The full picture the user asked for: who it's with, what kind of
  // consultation, and phone/in-person/video format — not just a bare block.
  assert.match(payloadFn, /Consultation type: \$\{appointment\.sessionType\.name\}/);
  assert.match(payloadFn, /Format: \$\{MEETING_MODE_LABEL\[appointment\.meetingMode\]/);
  assert.match(service, /request\("\/me\/events", \{ method: "POST"/);
  assert.match(service, /method: "PATCH"/);
  assert.match(service, /method: "DELETE" \}\)/);

  // Admins see every agency appointment on their own calendar; everyone else
  // only sees the ones assigned to them.
  const eligibleFn = service.slice(service.indexOf("async function eligibleViewers"), service.indexOf("const APPOINTMENT_INCLUDE"));
  assert.match(eligibleFn, /status: "connected", calendarSyncEnabled: true, agencyId: \{ in: agencyIds \}/);
  assert.match(eligibleFn, /isAdmin: connection\.user\?\.role === "admin"/);
  const dueFn = service.slice(service.indexOf("async function dueAppointmentsForViewer"), service.indexOf("async function dueDeletionsForViewer"));
  assert.match(dueFn, /\.\.\.\(viewer\.isAdmin \? \{\} : \{ assignedToId: viewer\.userId \}\)/);

  assert.match(service, /export function startOutlookCalendarSyncWorker/);
  assert.match(service, /export function stopOutlookCalendarSyncWorker/);
  assert.match(service, /export function scheduleImmediateOutlookCalendarSync/);

  const server = await source("../src/server.js");
  assert.match(server, /import \{\s*startOutlookCalendarSyncWorker,\s*stopOutlookCalendarSyncWorker,\s*\} from "\.\/services\/outlookCalendarSyncService\.js";/);
  assert.match(server, /startOutlookCalendarSyncWorker\(\);/);
  assert.match(server, /stopOutlookCalendarSyncWorker\(\);/);
});

test("booking, rescheduling, or cancelling an appointment fires a calendar sync almost immediately instead of waiting up to POLL_MS for the next poll", async () => {
  const meetingService = await source("../src/services/appointmentMeetingService.js");
  assert.match(meetingService, /import \{ scheduleImmediateOutlookCalendarSync \} from "\.\/outlookCalendarSyncService\.js";/);
  // enqueueAppointmentMeetingJob is the one function every booking/
  // reschedule/cancel call site across bookingController, publicBooking
  // Controller, lead.service, caseController, zoomController, and
  // quickbooksWebhookService already goes through — piggybacking the
  // calendar trigger there reaches all of them for free.
  const enqueueFn = meetingService.slice(meetingService.indexOf("export async function enqueueAppointmentMeetingJob"), meetingService.indexOf("async function markDone"));
  assert.match(enqueueFn, /scheduleImmediateOutlookCalendarSync\(\);/);

  const service = await source("../src/services/outlookCalendarSyncService.js");
  const scheduleFn = service.slice(service.indexOf("export function scheduleImmediateOutlookCalendarSync"), service.indexOf("export function startOutlookCalendarSyncWorker"));
  // Delayed, not called inline — most callers are still inside an open
  // db.$transaction() when this fires, so calling immediately would read
  // stale/uncommitted appointment state.
  assert.match(scheduleFn, /setTimeout\(\(\) => \{/);
  // Debounced to a single pending timer so a burst of mutations (e.g. a
  // recurring series) only schedules one extra pass, not one per mutation.
  assert.match(scheduleFn, /if \(pendingImmediateSync\) return;/);
});

test("a cancelled appointment's mirrored event is deleted per-viewer, and a failed sync retries on the next poll instead of being marked synced", async () => {
  const service = await source("../src/services/outlookCalendarSyncService.js");
  const syncOneFn = service.slice(service.indexOf("async function syncOneForViewer"), service.indexOf("async function deleteOneForViewer"));
  assert.match(syncOneFn, /appointmentId_userId: \{ appointmentId: appointment\.id, userId: viewer\.userId \}/);
  assert.match(syncOneFn, /update: \{ calendarEventId: eventId, syncStatus: "Synced", syncedAt: new Date\(\), syncError: null \}/);
  // On failure, syncedAt is deliberately left out of the failure update, so
  // dueAppointmentsForViewer's own "!sync.syncedAt" check picks this
  // appointment back up on the very next poll — no separate retry/backoff
  // bookkeeping needed.
  assert.match(syncOneFn, /update: \{ syncStatus: "Failed", syncError: String\(error\.message \|\| error\)\.slice\(0, 500\) \}/);

  const deleteFn = service.slice(service.indexOf("async function deleteOneForViewer"), service.indexOf("export async function processPendingOutlookCalendarSyncs"));
  assert.match(deleteFn, /removeAppointmentFromOutlookCalendar\(viewer\.userId, sync\.calendarEventId\)/);
  assert.match(deleteFn, /data: \{ calendarEventId: null, syncStatus: "Deleted", syncedAt: new Date\(\), syncError: null \}/);
});
