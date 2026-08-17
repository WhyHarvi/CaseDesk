import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [caseController, invoiceService, invoiceController, caseRoutes, caseProfile, billingWorkspace] = await Promise.all([
  readFile(new URL("../src/controllers/caseController.js", import.meta.url), "utf8"),
  readFile(new URL("../src/services/caseInvoiceService.js", import.meta.url), "utf8"),
  readFile(new URL("../src/controllers/caseInvoiceController.js", import.meta.url), "utf8"),
  readFile(new URL("../src/routes/caseRoutes.js", import.meta.url), "utf8"),
  readFile(new URL("../../frontend/src/pages/CaseProfile.jsx", import.meta.url), "utf8"),
  readFile(new URL("../../frontend/src/components/case-profile/CaseBillingWorkspace.jsx", import.meta.url), "utf8"),
]);

test("closing a case with money owing requires an explicit billing disposition", () => {
  assert.match(caseController, /getCasePaymentSummary\(req\.auth\.agencyId, existing\.id\)/);
  assert.match(caseController, /billingDisposition !== "keep_outstanding"/);
  assert.match(caseController, /OUTSTANDING_BILLING_REVIEW_REQUIRED/);
  assert.match(caseController, /retained for collection/);
  assert.match(caseProfile, /I reviewed the outstanding invoices/);
  assert.match(caseProfile, /billingDisposition: "keep_outstanding"/);
});

test("fully unpaid standalone invoices have an audited admin-only void path", () => {
  assert.match(caseRoutes, /invoices\/:invoiceId\/void[\s\S]*?requireRole\("admin"\)[\s\S]*?asyncHandler\(voidInvoice\)/);
  assert.match(invoiceController, /voidUnpaidCaseInvoice/);
  assert.match(invoiceService, /Enter why this invoice is being voided/);
  assert.match(invoiceService, /INVOICE_HAS_PAYMENT/);
  assert.match(invoiceService, /action: "invoice\.voided"/);
  assert.match(invoiceService, /data: \{ status: "Void", balance: 0/);
  assert.match(billingWorkspace, /Void invoice/);
  assert.match(billingWorkspace, /The reason is saved in case activity/);
});
