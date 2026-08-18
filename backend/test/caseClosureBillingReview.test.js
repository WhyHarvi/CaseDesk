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

test("closing a case with money owing requires an explicit billing disposition and a reason, with write-off admin-gated", () => {
  assert.match(caseController, /getCasePaymentSummary\(req\.auth\.agencyId, existing\.id\)/);
  assert.match(caseController, /if \(!\["keep_outstanding", "write_off"\]\.includes\(billingDisposition\)\) \{/);
  assert.match(caseController, /OUTSTANDING_BILLING_REVIEW_REQUIRED/);
  assert.match(caseController, /if \(!billingReason\) \{/);
  assert.match(caseController, /Enter a reason for how the outstanding balance is being handled\./);
  // Real incident: a Case Easy import landed a case in "Closed" with a $500
  // invoice still fully open, because the import path writes stage/status
  // directly and never runs through this endpoint's guard at all. Closing
  // a case here can now actually resolve that instead of just flagging it —
  // write off reuses the exact same admin-only, reason-required, real
  // QuickBooks-aware void path a single invoice already had.
  assert.match(caseController, /billingDisposition === "write_off" && req\.auth\.role !== "admin"/);
  assert.match(caseController, /import \{ voidUnpaidCaseInvoice \} from "\.\.\/services\/caseInvoiceService\.js";/);
  assert.match(caseController, /if \(Number\(invoice\.balance\) !== Number\(invoice\.amount\)\) continue;/);
  assert.match(caseController, /retained for collection/);
  assert.match(caseController, /written off/);

  assert.match(caseProfile, /Write off.*this balance will also be closed/);
  assert.match(caseProfile, /confirmDisabled=\{Number\(paymentSummary\.balance\) > 0 && !closeBillingReason\.trim\(\)\}/);
  assert.match(caseProfile, /role === "admin" \? \(/);
  assert.match(caseProfile, /billingDisposition: closeBillingDisposition, billingReason: closeBillingReason\.trim\(\)/);
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
