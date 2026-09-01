import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("team members connect a user-owned Microsoft mailbox instead of sharing agency credentials", async () => {
  const [schema, migration, routes, controller, service, server, settings, panel] = await Promise.all([
    source("../prisma/schema.prisma"),
    source("../prisma/migrations/20260721180000_user_mailbox_connections/migration.sql"),
    source("../src/routes/personalMailboxRoutes.js"),
    source("../src/controllers/personalMailboxController.js"),
    source("../src/services/microsoftMailboxService.js"),
    source("../src/server.js"),
    source("../../frontend/src/pages/Settings.jsx"),
    source("../../frontend/src/components/settings/PersonalMailboxSettingsPanel.jsx"),
  ]);

  assert.match(schema, /model UserMailboxConnection/);
  assert.match(schema, /userId\s+String\s+@unique/);
  assert.match(schema, /refreshTokenEncrypted\s+String/);
  assert.match(migration, /CREATE TABLE "user_mailbox_connections"/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(routes, /requireRole\("admin", "consultant", "frontdesk"\)/);
  assert.match(routes, /\/microsoft\/callback/);
  assert.match(controller, /req\.auth\.userId/);
  assert.match(service, /offline_access/);
  assert.match(service, /Mail\.Read/);
  assert.match(service, /Mail\.Send/);
  assert.match(service, /encryptSecret\(tokens\.refresh_token\)/);
  assert.match(service, /Sign in with your own CaseDesk email/);
  assert.match(server, /app\.use\("\/api\/mailboxes", personalMailboxRoutes\)/);
  assert.match(settings, /id: "personal-email"/);
  assert.match(panel, /Connect Outlook/);
  assert.match(panel, /Unrelated personal mail stays private/);
});

test("reconnecting to pick up a newly-added scope forces Microsoft to re-show consent, so grantedScopes actually changes instead of silently staying stale", async () => {
  const service = await source("../src/services/microsoftMailboxService.js");
  assert.match(service, /const SCOPES = \[.*"Calendars\.ReadWrite".*\];/);
  // "select_account" alone lets Microsoft reuse a prior consent without
  // showing the new scope — the granted token then still carries the OLD
  // scope, so grantedScopes never updates and the UI never flips to ready,
  // no matter how many times the person reconnects or refreshes. "consent"
  // forces the approval screen (and its accurate scope) every time.
  assert.match(service, /prompt: "select_account consent"/);
  assert.match(service, /export function mailboxGrantsCalendarAccess\(grantedScopes\)/);
});

test("calendar sync has its own on/off toggle, independent of the Microsoft grant — same relationship syncEnabled already has to email", async () => {
  const [schema, migration, service, controller, panel] = await Promise.all([
    source("../prisma/schema.prisma"),
    source("../prisma/migrations/20260828170000_mailbox_calendar_sync_toggle/migration.sql"),
    source("../src/services/microsoftMailboxService.js"),
    source("../src/controllers/personalMailboxController.js"),
    source("../../frontend/src/components/settings/PersonalMailboxSettingsPanel.jsx"),
  ]);
  assert.match(schema, /calendarSyncEnabled\s+Boolean\s+@default\(true\) @map\("calendar_sync_enabled"\)/);
  assert.match(migration, /ADD COLUMN\s+"calendar_sync_enabled" BOOLEAN NOT NULL DEFAULT true/);
  assert.match(service, /const calendarScopeGranted = Boolean\(connection\?\.status === "connected" && mailboxGrantsCalendarAccess\(connection\.grantedScopes\)\);/);
  assert.match(service, /calendarSyncReady: calendarScopeGranted && connection\?\.calendarSyncEnabled !== false/);
  assert.match(service, /values\.calendarSyncEnabled !== undefined \? \{ calendarSyncEnabled: values\.calendarSyncEnabled === true \} : \{\}/);
  assert.match(controller, /calendarSyncEnabled: req\.body\.calendarSyncEnabled/);
  // The button reads the two flags apart: no Microsoft grant yet → start
  // OAuth; grant already exists → this is purely our own preference, a
  // plain PATCH with no Microsoft round trip.
  assert.match(panel, /onClick=\{mailbox\.calendarScopeGranted \? toggleCalendarSync : connect\}/);
  assert.match(panel, /"Cancel sync"/);
  assert.match(panel, /"Turn on calendar sync"/);
  assert.doesNotMatch(panel, /connected before calendar sync existed/);
});

test("the Settings panel shows real sync counts instead of a static badge, polling live while the card is ready — a bare 'Syncing' badge gave no way to tell '0 have synced yet' apart from 'everything's already caught up'", async () => {
  const [service, controller, routes, panel] = await Promise.all([
    source("../src/services/outlookCalendarSyncService.js"),
    source("../src/controllers/personalMailboxController.js"),
    source("../src/routes/personalMailboxRoutes.js"),
    source("../../frontend/src/components/settings/PersonalMailboxSettingsPanel.jsx"),
  ]);
  const statsFn = service.slice(service.indexOf("export async function getOutlookCalendarSyncStats"), service.indexOf("export async function processPendingOutlookCalendarSyncs"));
  // "pending" reuses dueAppointmentsForViewer — the exact same query the
  // poller itself runs next — so the UI's count can never drift from what
  // will actually happen on the next tick.
  assert.match(statsFn, /dueAppointmentsForViewer\(viewer\)/);
  assert.match(statsFn, /pending: due\.length/);
  assert.match(controller, /getPersonalCalendarSyncStatus/);
  assert.match(routes, /router\.get\("\/me\/calendar-sync-status", requireAuth, teamMember, asyncHandler\(getPersonalCalendarSyncStatus\)\)/);

  assert.match(panel, /setInterval\(loadCalendarStats, 4_000\)/);
  assert.match(panel, /calendarStats\.pending > 0 \? `Syncing \$\{calendarStats\.pending\} more…` : "All caught up"/);
  // The poll only runs while the card is actually in a ready state — no
  // background timer left ticking once sync is off or the panel unmounts.
  assert.match(panel, /if \(!mailbox\.calendarSyncReady\) \{\s*setCalendarStats\(emptyCalendarStats\);\s*return undefined;\s*\}/);
  assert.match(panel, /return \(\) => clearInterval\(interval\);/);
});

test("user-authored CRM email uses its sender mailbox while automation keeps the agency sender", async () => {
  const [provider, outbox, inbound, agencyMail] = await Promise.all([
    source("../src/services/communicationProviderService.js"),
    source("../src/services/communicationOutboxService.js"),
    source("../src/services/inboundMailSyncService.js"),
    source("../src/services/agencyMailService.js"),
  ]);

  assert.match(provider, /if \(userId\)/);
  assert.match(provider, /sendMicrosoftMailboxEmail/);
  assert.match(outbox, /userId: job\.message\.senderUserId/);
  assert.match(provider, /resolveAgencyMailConfig\(agencyId\)/);
  assert.match(agencyMail, /System SMTP/);
  assert.match(inbound, /syncPersonalMicrosoftMailbox/);
  assert.match(inbound, /only CRM-related mail is imported/);
  assert.match(inbound, /microsoftMessageId/);
});

test("Microsoft Sent Items replies are merged into the client email history without duplicating CaseDesk sends", async () => {
  const [inbound, schema, migration] = await Promise.all([
    source("../src/services/inboundMailSyncService.js"),
    source("../prisma/schema.prisma"),
    source("../prisma/migrations/20260901120000_mailbox_sent_sync_checkpoint/migration.sql"),
  ]);
  assert.match(inbound, /async function syncMicrosoftSentItems/);
  assert.match(inbound, /\/me\/mailFolders\/sentitems\/messages/);
  assert.match(inbound, /async function ingestMicrosoftSentEmail/);
  assert.match(inbound, /direction: "Outbound"/);
  assert.match(inbound, /state: "WaitingOnClient"/);
  assert.match(inbound, /graphHeader\(message, "x-casedesk-message-id"\)/);
  assert.match(inbound, /senderUserId: connection\.userId/);
  assert.match(inbound, /connection\.lastSentSyncedAt/);
  assert.match(inbound, /lastSentSyncedAt: startedAt/);
  assert.match(schema, /lastSentSyncedAt\s+DateTime\?\s+@map\("last_sent_synced_at"\)/);
  assert.match(migration, /agency_microsoft_mailbox_connections/);
  assert.match(migration, /user_mailbox_connections/);
});

test("workspace administrators connect a Microsoft system mailbox for automation and inbound replies", async () => {
  const [schema, migration, routes, controller, service, agencyMail, inbound, panel] = await Promise.all([
    source("../prisma/schema.prisma"),
    source("../prisma/migrations/20260728183000_agency_microsoft_mailbox_connection/migration.sql"),
    source("../src/routes/personalMailboxRoutes.js"),
    source("../src/controllers/personalMailboxController.js"),
    source("../src/services/microsoftMailboxService.js"),
    source("../src/services/agencyMailService.js"),
    source("../src/services/inboundMailSyncService.js"),
    source("../../frontend/src/components/settings/AgencyMailSettingsPanel.jsx"),
  ]);

  assert.match(schema, /model AgencyMicrosoftMailboxConnection/);
  assert.match(schema, /agencyId\s+String\s+@unique/);
  assert.match(schema, /inboundEnabled\s+Boolean\s+@default\(true\)/);
  assert.match(migration, /CREATE TABLE "agency_microsoft_mailbox_connections"/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(routes, /\/system\/microsoft\/connect/);
  assert.match(routes, /requireAuth, admin/);
  assert.match(controller, /buildAgencyMicrosoftMailboxState/);
  assert.match(controller, /saveAgencyMicrosoftMailboxConnection/);
  assert.match(service, /agencyMicrosoftGraphClient/);
  assert.match(service, /sendAgencyMicrosoftMailboxEmail/);
  assert.match(agencyMail, /config\.graph === true/);
  assert.match(agencyMail, /sendAgencyMicrosoftMailboxEmail/);
  assert.match(inbound, /syncAgencyMicrosoftMailbox/);
  assert.match(inbound, /microsoft-system:/);
  assert.match(panel, /Connect the Microsoft system mailbox/);
  assert.match(panel, /\/mailboxes\/system\/microsoft\/connect/);
  assert.match(panel, /Receive client replies in CaseDesk/);
});
