import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("client management stores searchable identity fields and archives without deletion", async () => {
  const [schema, migration, controller, routes, page, profile] = await Promise.all([
    source("../prisma/schema.prisma"),
    source("../prisma/migrations/20260716120000_complete_client_management/migration.sql"),
    source("../src/controllers/clientController.js"),
    source("../src/routes/clientRoutes.js"),
    source("../../frontend/src/pages/Clients.jsx"),
    source("../../frontend/src/pages/ClientProfile.jsx"),
  ]);

  assert.match(schema, /clientNumber\s+String\s+@map\("client_number"\)/);
  assert.match(schema, /preferredLanguage\s+String\?/);
  assert.match(schema, /identificationNumber\s+String\?/);
  assert.match(schema, /archivedAt\s+DateTime\?/);
  assert.match(schema, /creationIdempotencyKey\s+String\?/);
  assert.match(migration, /CREATE UNIQUE INDEX "clients_agency_id_client_number_key"/);
  assert.match(controller, /assertNoContactDuplicate/);
  assert.match(controller, /findClientContactMatches/);
  assert.match(controller, /AND: \[clientAccessWhere\(req\), \{ OR: contact \}\]/);
  assert.match(routes, /"\/contact-matches"/);
  assert.match(controller, /agencyId_creationIdempotencyKey/);
  assert.match(controller, /archivedAt: new Date\(\), status: "Inactive"/);
  assert.doesNotMatch(routes, /router\.delete/);
  assert.match(page, /archive-impact/);
  assert.match(page, /client\.clientNumber/);
  assert.match(page, /directoryOrder === "recentlyAdded"/);
  assert.match(page, /new Date\(right\.createdAt \|\| 0\)/);
  assert.match(page, /Recently added/);
  assert.match(page, /clientCreateIdempotencyKey/);
  assert.match(page, /This person is already in CaseDesk/);
  assert.match(page, /Go to profile/);
  assert.match(page, /Book appointment/);
  assert.match(page, /\/clients\/contact-matches/);
  assert.match(profile, /Preferred language/);
  assert.match(profile, /Identification/);
});

test("the duplicate-client check also searches unconverted Case Easy import data, with an import action right from the Add Client form", async () => {
  const [controller, routes, clientsPage, curtains] = await Promise.all([
    source("../src/controllers/clientController.js"),
    source("../src/routes/clientRoutes.js"),
    source("../../frontend/src/pages/Clients.jsx"),
    source("../../frontend/src/components/layout/QuickCreateCurtains.jsx"),
  ]);

  // Real gap, confirmed against live agency data: of 3,793+ imported Case
  // Easy contacts, only a couple had ever been converted to real Client
  // rows — so someone already sitting in that staged data sailed straight
  // through this duplicate check, because it only ever looked at the
  // Client table. Live-verified end to end: a matching contact now shows
  // up under caseEasyContacts, and importing it (reusing the same
  // bulk-convert endpoint the Case Easy Import page itself uses) produces
  // a real Client row.
  assert.match(controller, /async function findCaseEasyContactMatches\(req, email, phoneDigits\)/);
  assert.match(controller, /if \(!hasPortalPageAccess\(req, "caseEasyImport"\)\) return \[\];/);
  assert.match(controller, /importStatus: \{ not: "converted" \}/);
  assert.match(controller, /data: \{ clients: \[\], caseEasyContacts: \[\] \}/);
  assert.match(controller, /caseEasyContacts,\s*\n\s*\},\s*\n\s*\}\);/);

  assert.match(clientsPage, /Found in imported Case Easy data/);
  assert.match(clientsPage, /Not yet a CaseDesk client\. Import their record instead of starting from scratch\./);
  assert.match(clientsPage, /onImportCaseEasyContact\(contact, false\)/);
  assert.match(clientsPage, /onImportCaseEasyContact\(contact, true\)/);
  assert.match(clientsPage, /"\/case-easy-import\/contacts\/bulk-convert", \{ contactIds: \[contact\.id\] \}/);
  assert.match(clientsPage, /response\.data\.data\?\.clients \|\| \[\]/);
  assert.match(clientsPage, /response\.data\.data\?\.caseEasyContacts \|\| \[\]/);

  // The same Add Client form is reused (not reimplemented) by the header's
  // quick-create curtain, so the fix needed wiring in both places.
  assert.match(curtains, /caseEasyMatches=\{caseEasyMatches\}/);
  assert.match(curtains, /onImportCaseEasyContact=\{importCaseEasyContact\}/);
  assert.match(curtains, /"\/case-easy-import\/contacts\/bulk-convert", \{ contactIds: \[contact\.id\] \}/);
});

test("clients converted from a Case Easy import are labeled everywhere a client is shown", async () => {
  const [controller, badge, clientsPage, profile] = await Promise.all([
    source("../src/controllers/clientController.js"),
    source("../../frontend/src/components/clients/CaseEasyOriginBadge.jsx"),
    source("../../frontend/src/pages/Clients.jsx"),
    source("../../frontend/src/pages/ClientProfile.jsx"),
  ]);

  // Both the list endpoint (scopedInclude -> include) and the detail
  // endpoint (clientIdentitySelect) need this — they're two separate
  // Prisma query shapes, not one shared select.
  assert.match(controller, /caseEasyImportContacts: \{ select: \{ id: true \}, take: 1 \}/g);
  assert.equal(
    (controller.match(/caseEasyImportContacts: \{ select: \{ id: true \}, take: 1 \}/g) || []).length,
    2,
  );

  assert.match(badge, /Case Easy/);

  assert.match(clientsPage, /client\.caseEasyImportContacts\?\.length \? <CaseEasyOriginBadge \/> : null/);
  assert.equal(
    (clientsPage.match(/client\.caseEasyImportContacts\?\.length \? <CaseEasyOriginBadge \/> : null/g) || []).length,
    2,
  );
  assert.match(profile, /client\.caseEasyImportContacts\?\.length \? <CaseEasyOriginBadge \/> : null/);
});

test("front desk client intake separates consultation payments from professional fees", async () => {
  const [clientsPage, calendarPage, casesPage, profile, billingCard, entrySheet, caseController] = await Promise.all([
    source("../../frontend/src/pages/Clients.jsx"),
    source("../../frontend/src/pages/CalendarPage.jsx"),
    source("../../frontend/src/pages/Cases.jsx"),
    source("../../frontend/src/pages/ClientProfile.jsx"),
    source("../../frontend/src/components/clients/ClientBillingCard.jsx"),
    source("../../frontend/src/components/clients/ClientManualBillingEntrySheet.jsx"),
    source("../src/controllers/caseController.js"),
  ]);

  assert.match(clientsPage, /showFrontDeskActions=\{role === "frontdesk" && !isEditing\}/);
  assert.match(clientsPage, /Book appointment/);
  assert.match(clientsPage, /Charge the fee or skip/);
  assert.doesNotMatch(clientsPage, /Book \+ consult fee/);
  assert.doesNotMatch(clientsPage, /You can adjust it for this intake/);
  assert.match(clientsPage, /professional-payment/);
  assert.match(clientsPage, /Professional fee/);
  assert.match(clientsPage, /Also book a consultation/);
  assert.match(clientsPage, /bookAppointmentAfterPayment/);
  assert.match(clientsPage, /after=professional-payment/);
  assert.match(clientsPage, /\/app\/calendar\?bookForClient=/);
  assert.match(clientsPage, /state: \{[\s\S]*frontDeskIntake:/);
  assert.match(calendarPage, /role === "frontdesk" \? location\.state\?\.frontDeskIntake/);
  assert.match(calendarPage, /How will they pay\?/);
  assert.match(calendarPage, /intakePaymentRequested \? \[\] : \[\["Skip", "Skip"\]\]/);
  assert.match(calendarPage, /Client created — finish the appointment/);
  assert.match(calendarPage, /idempotencyKey: newBookingOperationKey\(\)/);
  assert.match(calendarPage, /idempotencyKey: form\.idempotencyKey/);
  assert.match(casesPage, /afterCreateActionRef\.current === "professional-payment"/);
  assert.match(casesPage, /openBillingEntry: true/);
  assert.match(casesPage, /paymentType: "fees"/);
  assert.match(casesPage, /afterSave: bookAppointmentAfterPaymentRef\.current \? "appointment" : ""/);
  assert.match(casesPage, /function cancelDrawers\(\)[\s\S]*afterCreateActionRef\.current = ""/);
  assert.match(casesPage, /idempotencyKey: caseCreateIdempotencyKey/);
  const optimisticCaseIndex = casesPage.indexOf("const optimisticCase = createOptimisticCase");
  const createCaseRequestIndex = casesPage.indexOf('const response = await api.post("/cases", payload);', optimisticCaseIndex);
  const firstCloseAfterOptimisticIndex = casesPage.indexOf("closeDrawers();", optimisticCaseIndex);
  assert.ok(optimisticCaseIndex >= 0 && createCaseRequestIndex > optimisticCaseIndex);
  assert.ok(firstCloseAfterOptimisticIndex > createCaseRequestIndex, "the case drawer must stay open until creation is confirmed");
  assert.match(caseController, /agencyId_creationIdempotencyKey/);
  assert.match(profile, /initialEntry=\{initialBillingEntry\}/);
  assert.match(profile, /state: \{ frontDeskIntake: \{ action: "appointment" \} \}/);
  assert.match(billingCard, /initialPaymentType=\{entryPreset\?\.paymentType\}/);
  assert.match(entrySheet, /initialMode === "new"/);
  assert.match(entrySheet, /item\.code === initialPaymentType/);
});
