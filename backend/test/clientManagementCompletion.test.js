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
  assert.match(controller, /agencyId_creationIdempotencyKey/);
  assert.match(controller, /archivedAt: new Date\(\), status: "Inactive"/);
  assert.doesNotMatch(routes, /router\.delete/);
  assert.match(page, /archive-impact/);
  assert.match(page, /client\.clientNumber/);
  assert.match(page, /directoryOrder === "recentlyAdded"/);
  assert.match(page, /new Date\(right\.createdAt \|\| 0\)/);
  assert.match(page, /Recently added/);
  assert.match(page, /clientCreateIdempotencyKey/);
  assert.match(profile, /Preferred language/);
  assert.match(profile, /Identification/);
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
