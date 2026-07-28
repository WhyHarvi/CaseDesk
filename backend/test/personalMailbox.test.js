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
