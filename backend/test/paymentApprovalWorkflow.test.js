import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  applyLocalCashToInvoice,
  validateStaffPayment,
} from "../src/services/paymentApprovalLedgerService.js";

test("approved cash reduces the CaseDesk balance without changing the cached QuickBooks balance", () => {
  const invoice = applyLocalCashToInvoice({
    amount: 500,
    balance: 500,
    status: "Open",
    lastPaymentMethod: null,
    lastPaymentAt: null,
    paymentApprovals: [{ status: "Approved", method: "Cash", amount: 125, paymentDate: new Date("2026-08-11") }],
  });
  assert.equal(invoice.quickBooksBalance, 500);
  assert.equal(invoice.localCashPaid, 125);
  assert.equal(invoice.balance, 375);
  assert.equal(invoice.status, "PartiallyPaid");
  assert.equal(invoice.lastPaymentMethod, "Cash");
});

test("pending and rejected cash do not change the CaseDesk invoice balance", () => {
  const invoice = applyLocalCashToInvoice({
    amount: 500,
    balance: 500,
    status: "Open",
    paymentApprovals: [
      { status: "Pending", method: "Cash", amount: 100 },
      { status: "Rejected", method: "Cash", amount: 100 },
      { status: "Approved", method: "ETransfer", amount: 100 },
    ],
  });
  assert.equal(invoice.balance, 500);
  assert.equal(invoice.localCashPaid, 0);
});

test("staff payment validation requires an e-transfer reference but permits an optional cash receipt", () => {
  assert.throws(() => validateStaffPayment({ method: "ETransfer", amount: 100, paymentDate: "2026-08-11" }), /transaction number/i);
  assert.equal(validateStaffPayment({ method: "Cash", amount: 100, paymentDate: "2026-08-11" }).numericAmount, 100);
});

test("frontdesk payments are approval-gated and cash branches never create a QuickBooks payment", async () => {
  const [approvalService, bookingService, invoiceService, bookingController, billingController, routes, paymentsPage, migration] = await Promise.all([
    readFile(new URL("../src/services/paymentApprovalService.js", import.meta.url), "utf8"),
    readFile(new URL("../src/services/bookingPaymentHoldService.js", import.meta.url), "utf8"),
    readFile(new URL("../src/services/caseInvoiceService.js", import.meta.url), "utf8"),
    readFile(new URL("../src/controllers/bookingController.js", import.meta.url), "utf8"),
    readFile(new URL("../src/controllers/accountStatementController.js", import.meta.url), "utf8"),
    readFile(new URL("../src/routes/paymentsOverviewRoutes.js", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/src/pages/Payments.jsx", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20260811190000_payment_approval_workflow/migration.sql", import.meta.url), "utf8"),
  ]);

  assert.match(bookingController, /req\.auth\.role === "frontdesk"[\s\S]*submitPaymentApproval/);
  assert.match(billingController, /req\.auth\.role === "frontdesk" \|\| req\.body\?\.method === "Cash"/);
  assert.match(approvalService, /status: PAYMENT_APPROVAL_STATUSES\.processing/);
  assert.match(approvalService, /row\.entryType === "new_charge_payment" && row\.method === "Cash"[\s\S]*prisma\.payment\.create/);
  assert.match(bookingService, /if \(method === "Cash"\)[\s\S]*quickBooksStored: false[\s\S]*return hold;/);
  assert.match(invoiceService, /if \(method === "Cash"\)[\s\S]*quickBooksStored: false[\s\S]*return updated;/);
  assert.match(routes, /approvals\/:id\/approve/);
  assert.match(routes, /approvals\/:id\/reject/);
  assert.match(paymentsPage, /function PaymentApprovalsSection/);
  assert.match(paymentsPage, /CaseDesk-only cash record/);
  assert.match(migration, /CREATE TABLE "payment_approvals"/);
});

test("case Billing exposes CaseDesk-only cash entry and refreshes effective totals", async () => {
  const [workspace, sheet, scheduleService, tabs, profile] = await Promise.all([
    readFile(new URL("../../frontend/src/components/case-profile/CaseBillingWorkspace.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/src/components/clients/ClientManualBillingEntrySheet.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/services/paymentScheduleService.js", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/src/components/case-profile/CaseWorkspaceTabs.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/src/pages/CaseProfile.jsx", import.meta.url), "utf8"),
  ]);

  assert.match(workspace, /Record cash/);
  assert.match(workspace, /fixedMethod="Cash"/);
  assert.match(workspace, /restrictCaseId=\{caseItem\.id\}/);
  assert.match(workspace, /\["admin", "consultant", "frontdesk"\]\.includes\(role\)/);
  assert.match(sheet, /Cash · CaseDesk only/);
  assert.match(sheet, /approvalRequiredForEntries/);
  assert.match(scheduleService, /\.then\(\(rows\) => rows\.map\(applyLocalCashToInvoice\)\)/);
  assert.match(tabs, /onBillingChanged=\{onBillingChanged\}/);
  assert.match(profile, /const refreshPaymentSummary = useCallback/);
});
