import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isQuickBooksDuplicateDocumentNumberError } from "../src/services/quickbooksService.js";

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
  assert.match(portalController, /clientId: link\.clientId, status: \{ in: \["AwaitingPaymentMethod", "Open", "Overdue"\] \}/);
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
  assert.match(portal, /min-h-\[76px\]/);
  assert.match(portal, /h-12 w-full/);
  assert.match(portal, /grid-cols-\[2rem_1fr_auto\]/);
  assert.match(portal, /Number\(surchargeRates\?\.cardSurchargeRatePercent \|\| 0\)/);
});

test("a client can change the method on the same fully-unpaid QuickBooks invoice", async () => {
  const [quickBooksService, invoiceService, portalController, portal] = await Promise.all([
    source("../src/services/quickbooksService.js"),
    source("../src/services/caseInvoiceService.js"),
    source("../src/controllers/clientPortalController.js"),
    source("../../frontend/src/pages/client-portal/ClientPortalPayments.jsx"),
  ]);

  assert.match(quickBooksService, /export async function updateQuickBooksInvoice/);
  assert.match(quickBooksService, /currentMapped\.totalAmount - currentMapped\.balance/);
  assert.match(quickBooksService, /Line: buildQuickBooksInvoiceLines/);
  assert.match(invoiceService, /const baseTotal = money\(Number\(existing\.subtotalAmount\) \+ Number\(existing\.taxAmount\) - Number\(existing\.discountAmount\)\)/);
  assert.match(invoiceService, /invoice = await updateQuickBooksInvoice/);
  assert.match(invoiceService, /INVOICE_PAYMENT_METHOD_LOCKED/);
  assert.match(invoiceService, /action: isChangingMethod \? "invoice\.payment_method_changed"/);
  assert.match(portalController, /canChangePaymentMethod:/);
  assert.match(portalController, /Math\.abs\(Number\(invoice\.amount\) - Number\(invoice\.balance\)\) <= 0\.01/);
  assert.match(portalController, /removeDocumentFile\(invoice\.clientPaymentProofStorageKey\)/);
  assert.match(portal, /Change payment method/);
  assert.match(portal, /Keep current method/);
  assert.match(portal, /changingInvoiceId === invoice\.id/);
  assert.match(portalController, /baseAmount: money\(Number\(invoice\.subtotalAmount\) \+ Number\(invoice\.taxAmount\) - Number\(invoice\.discountAmount\)\)/);
  assert.match(portal, /Number\(invoice\.baseAmount \?\? invoice\.balance\)/);
  assert.doesNotMatch(portal, /const base = Number\(invoice\.balance\)/);
  assert.match(portal, /Choosing another method replaces the current processing fee/);
  assert.match(portalController, /cardSurchargeAmount: money\(\(invoice\.lines \|\| \[\]\)/);
  assert.match(portal, /Confirm you will pay by credit card/);
  assert.match(portal, /choosing another method inside QuickBooks will not remove it/);
  assert.match(portal, /Continue with credit card/);
  assert.match(portal, /Choose debit instead/);
  assert.match(portal, /Credit card surcharge included/);
});

test("configured processing rates stay visible and missing QuickBooks fee items are provisioned", async () => {
  const [feeCategories, invoiceService, portalController] = await Promise.all([
    source("../src/services/feeCategoryService.js"),
    source("../src/services/caseInvoiceService.js"),
    source("../src/controllers/clientPortalController.js"),
  ]);

  assert.match(feeCategories, /export async function ensureProcessingFeeCategoryMapping/);
  assert.match(feeCategories, /accountType === "Other Income"/);
  assert.match(feeCategories, /createQuickBooksItem\(agencyId/);
  assert.match(feeCategories, /quickbooks\.processing_fee_item_mapped/);
  assert.match(invoiceService, /surchargeCategory = await ensureProcessingFeeCategoryMapping/);
  assert.match(portalController, /cardSurchargeRatePercent: Number\(quickBooksSettings\.cardSurchargeRatePercent\)/);
  assert.match(portalController, /bankTransferFeeRatePercent: Number\(quickBooksSettings\.bankTransferFeeRatePercent\)/);
  assert.doesNotMatch(portalController, /cardSurchargeItemId \? Number\(quickBooksSettings\.cardSurchargeRatePercent\) : 0/);
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

test("QuickBooks duplicate document numbers are recognized and reconciled before any retry", async () => {
  const [quickBooksService, invoiceService] = await Promise.all([
    source("../src/services/quickbooksService.js"),
    source("../src/services/caseInvoiceService.js"),
  ]);
  const duplicate = Object.assign(new Error("Duplicate Document Number Error: You must specify a different number. DocNumber=INV-2026-4442A20A is assigned to TxnType=Invoice with TxnId=396"), { qboFaultCode: "6140" });

  assert.equal(isQuickBooksDuplicateDocumentNumberError(duplicate), true);
  assert.equal(isQuickBooksDuplicateDocumentNumberError(new Error("Invalid Reference Id")), false);
  assert.match(quickBooksService, /findQuickBooksInvoiceByDocumentNumber/);
  assert.match(quickBooksService, /WHERE DocNumber =/);
  assert.match(invoiceService, /quickBooksInvoiceMatchesDraft/);
  assert.match(invoiceService, /The provider create succeeded but the local finalize did not/);
  assert.match(invoiceService, /resolvedInvoiceNumber = newInvoiceNumber/);
  assert.match(invoiceService, /invoiceNumber: resolvedInvoiceNumber/);
  assert.match(invoiceService, /caseInvoiceLine\.deleteMany\(\{ where: \{ invoiceId: existing\.id \} \}\)/);
  assert.doesNotMatch(invoiceService, /caseInvoiceLine\.deleteMany\(\{ where: \{ caseInvoiceId:/);
  const finalizeStart = invoiceService.indexOf("export async function finalizeAwaitingPaymentMethodInvoice");
  const finalizeBody = invoiceService.slice(finalizeStart, invoiceService.indexOf("\nexport ", finalizeStart + 1));
  assert.doesNotMatch(finalizeBody, /data: \{\s*clientId: client\.id,/);
});
