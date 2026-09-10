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
  assert.match(portalController, /clientId: link\.clientId, status: "AwaitingPaymentMethod"/);
  assert.match(portalController, /finalizeAwaitingPaymentMethodInvoice/);

  assert.doesNotMatch(workspace, /PAYMENT_METHOD_OPTIONS/);
  assert.doesNotMatch(workspace, /paymentMethod:/);
  assert.match(workspace, /Client chooses the online payment method/);
  assert.match(workspace, /invoice\.status !== "AwaitingPaymentMethod"/);

  assert.match(portal, /choose\("bankTransfer"\)/);
  assert.match(portal, /choose\("card"\)/);
  assert.match(portal, /Each option includes its own processing fee/);
});

test("an unfinalized staff invoice can be voided without a QuickBooks invoice", async () => {
  const service = await source("../src/services/caseInvoiceService.js");

  assert.match(
    service,
    /invoice\.accountingProvider === ACCOUNTING_PROVIDERS\.QUICKBOOKS && invoice\.status !== "AwaitingPaymentMethod"/,
  );
});
