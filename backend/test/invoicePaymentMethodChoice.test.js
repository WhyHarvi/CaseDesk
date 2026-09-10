import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("staff-created invoices defer the online payment method to the client", async () => {
  const [controller, portalController, service, workspace, portal] = await Promise.all([
    source("../src/controllers/caseInvoiceController.js"),
    source("../src/controllers/clientPortalController.js"),
    source("../src/services/caseInvoiceService.js"),
    source("../../frontend/src/components/case-profile/CaseBillingWorkspace.jsx"),
    source("../../frontend/src/pages/client-portal/ClientPortalPayments.jsx"),
  ]);

  assert.match(controller, /deferMethodChoice: true/);
  assert.doesNotMatch(controller, /req\.body\?\.paymentMethod/);
  assert.match(service, /deferMethodChoice = false/);
  assert.match(service, /deferMethodChoice: accountingProvider === ACCOUNTING_PROVIDERS\.QUICKBOOKS && deferMethodChoice/);
  assert.match(service, /status: "AwaitingPaymentMethod"/);
  assert.match(service, /AUTOMATIC_PROCESSING_FEE_KINDS\.has\(category\.kind\)/);
  assert.match(service, /Processing fees are added automatically after the client chooses an online payment method/);
  assert.match(portalController, /clientId: link\.clientId, status: "AwaitingPaymentMethod"/);
  assert.match(portalController, /finalizeAwaitingPaymentMethodInvoice/);
  assert.match(portalController, /clientPaymentSubmittedAt/);
  assert.match(portalController, /proofStorageKey/);

  assert.doesNotMatch(workspace, /PAYMENT_METHOD_OPTIONS/);
  assert.doesNotMatch(workspace, /paymentMethod:/);
  assert.match(workspace, /categories\.filter\(\(category\) => !AUTOMATIC_PROCESSING_FEE_KINDS\.has\(category\.kind\)\)/);
  assert.match(workspace, /Client chooses the online payment method/);
  assert.match(workspace, /invoice\.status !== "AwaitingPaymentMethod"/);

  assert.match(portal, /value: "bankTransfer"/);
  assert.match(portal, /value: "card"/);
  assert.match(portal, /Interac e-Transfer/);
  assert.match(portal, /Debit card/);
  assert.match(portal, /Other payment method/);
  assert.match(portal, /Submit for confirmation/);
  assert.match(service, /card: false, bankTransfer: false/);
  assert.match(service, /surchargeCategory\.qboItemId/);
});

test("client payment evidence is isolated from confirmed payment fields and staff can review it", async () => {
  const [schema, portalController, controller, portalRoutes, routes, workspace, upload] = await Promise.all([
    source("../prisma/schema.prisma"),
    source("../src/controllers/clientPortalController.js"),
    source("../src/controllers/caseInvoiceController.js"),
    source("../src/routes/clientPortalRoutes.js"),
    source("../src/routes/caseRoutes.js"),
    source("../../frontend/src/components/case-profile/CaseBillingWorkspace.jsx"),
    source("../src/middleware/paymentProofUpload.js"),
  ]);

  assert.match(schema, /clientPaymentReference/);
  assert.match(schema, /clientPaymentProofStorageKey/);
  assert.match(schema, /clientPaymentSubmittedAt/);
  assert.match(portalController, /acceptsEvidence && req\.file/);
  assert.match(portalRoutes, /receivePaymentProof/);
  assert.match(routes, /payment-proof/);
  assert.match(controller, /clientPaymentProofStorageKey/);
  assert.match(workspace, /Confirm the funds were received before recording this payment/);
  assert.match(workspace, /downloadCaseInvoicePaymentProof/);
  assert.match(upload, /5 \* 1024 \* 1024/);
  assert.match(upload, /image\/jpeg/);
});

test("an unfinalized staff invoice can be voided without a QuickBooks invoice", async () => {
  const service = await source("../src/services/caseInvoiceService.js");

  assert.match(
    service,
    /invoice\.accountingProvider === ACCOUNTING_PROVIDERS\.QUICKBOOKS && invoice\.status !== "AwaitingPaymentMethod"/,
  );
});
