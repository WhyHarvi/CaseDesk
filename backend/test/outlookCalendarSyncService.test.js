import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("appointments mirror one-way onto the assigned staff member's own Outlook calendar as busy blocks, never as a meeting invite to the client", async () => {
  const [schema, migration, service] = await Promise.all([
    source("../prisma/schema.prisma"),
    source("../prisma/migrations/20260828160000_appointment_outlook_calendar_sync/migration.sql"),
    source("../src/services/outlookCalendarSyncService.js"),
  ]);
  assert.match(schema, /calendarSyncStatus\s+String\s+@default\("NotSynced"\) @map\("calendar_sync_status"\)/);
  assert.match(schema, /calendarEventId\s+String\?\s+@map\("calendar_event_id"\)/);
  assert.match(migration, /ALTER TABLE "appointments" ADD COLUMN\s+"calendar_event_id" TEXT/);

  assert.match(service, /import \{ microsoftGraphClient, mailboxGrantsCalendarAccess \} from "\.\/microsoftMailboxService\.js";/);
  // One event per staff member's own calendar, created via their personal
  // delegated token — never the agency system mailbox, and never with
  // attendees (that would silently email the client a Microsoft invite
  // outside CaseDesk's own guarded notification system).
  assert.match(service, /microsoftGraphClient\(appointment\.assignedToId\)/);
  const payloadFn = service.slice(service.indexOf("function outlookEventPayload"), service.indexOf("// Creates or updates the mirrored event"));
  assert.doesNotMatch(payloadFn, /attendees/i);
  assert.match(service, /request\("\/me\/events", \{ method: "POST"/);
  assert.match(service, /request\(`\/me\/events\/\$\{encodeURIComponent\(appointment\.calendarEventId\)\}`, \{ method: "PATCH"/);
  assert.match(service, /request\(`\/me\/events\/\$\{encodeURIComponent\(appointment\.calendarEventId\)\}`, \{ method: "DELETE" \}\)/);

  // Reconciliation is driven by comparing updatedAt to calendarSyncedAt
  // (any appointment mutation already bumps updatedAt for free), not by
  // hooking the many booking/reschedule/cancel call sites individually.
  assert.match(service, /"calendar_synced_at" IS NULL OR "calendar_synced_at" < "updated_at"/);
  assert.match(service, /mailboxGrantsCalendarAccess\(connection\.grantedScopes\)/);
  assert.match(service, /export function startOutlookCalendarSyncWorker/);
  assert.match(service, /export function stopOutlookCalendarSyncWorker/);

  const server = await source("../src/server.js");
  assert.match(server, /import \{\s*startOutlookCalendarSyncWorker,\s*stopOutlookCalendarSyncWorker,\s*\} from "\.\/services\/outlookCalendarSyncService\.js";/);
  assert.match(server, /startOutlookCalendarSyncWorker\(\);/);
  assert.match(server, /stopOutlookCalendarSyncWorker\(\);/);
});

test("a cancelled appointment's mirrored Outlook event is deleted, and a failed sync retries on the next poll instead of being marked synced", async () => {
  const service = await source("../src/services/outlookCalendarSyncService.js");
  const syncOneFn = service.slice(service.indexOf("async function syncOne"), service.indexOf("export async function processPendingOutlookCalendarSyncs"));
  assert.match(syncOneFn, /if \(appointment\.status === "Cancelled"\)/);
  assert.match(syncOneFn, /calendarSyncStatus: "Deleted", calendarSyncedAt: new Date\(\), calendarEventId: null/);
  assert.match(syncOneFn, /calendarSyncStatus: "Synced", calendarSyncedAt: new Date\(\), calendarEventId: eventId/);
  // On failure, calendarSyncedAt is deliberately left untouched (absent from
  // this exact data object) so the raw "synced_at < updated_at" query above
  // picks the appointment back up on the very next poll — no separate
  // retry/backoff bookkeeping needed.
  assert.match(
    syncOneFn,
    /data: \{ calendarSyncStatus: "Failed", calendarSyncError: String\(error\.message \|\| error\)\.slice\(0, 500\) \},/,
  );
});
