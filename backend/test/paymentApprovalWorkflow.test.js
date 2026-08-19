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
  assert.throws(() => validateStaffPayment({ method: "Cheque", amount: 100, paymentDate: "2026-08-11" }), /reference/i);
  assert.equal(validateStaffPayment({ method: "Cheque", amount: 100, transactionReference: "CHK-100", paymentDate: "2026-08-11" }).reference, "CHK-100");
  assert.equal(validateStaffPayment({ method: "Cash", amount: 100, paymentDate: "2026-08-11" }).numericAmount, 100);
});

test("only cash needs administrator approval — frontdesk's other consultation payment methods post directly, and cash branches use the CaseDesk Cash ledger", async () => {
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

  // A real incident: the same $100 e-transfer for one appointment was
  // recorded three times because it sat in an ambiguous approval queue
  // instead of posting immediately — Cash is the one method CaseDesk can't
  // verify against a bank reference on its own, so it alone still goes
  // through review; every other manual method (a real e-transfer, cheque,
  // wire, etc.) has a checkable reference and posts right away, for every
  // role, on a consultation payment.
  assert.match(bookingController, /req\.auth\.role === "frontdesk" && paymentMethod === "Cash"[\s\S]*submitPaymentApproval/);
  assert.match(bookingController, /req\.auth\.role === "frontdesk" && method === "Cash"/);
  assert.doesNotMatch(bookingController, /if \(req\.auth\.role === "frontdesk"\) \{/);
  // Case billing (a new charge, or a payment against an existing invoice)
  // is untouched — frontdesk still needs review there regardless of
  // method, since unlike a fixed consultation fee, those amounts are
  // typed in freehand.
  assert.match(billingController, /req\.body\?\.method === "Cash" \|\| \(req\.auth\.role === "frontdesk" && !isAppointmentPayment\)/);
  assert.match(billingController, /const isAppointmentPayment = \["appointment_payment", "appointment_payment_details"\]\.includes\(entryType\);/);
  assert.match(approvalService, /status: PAYMENT_APPROVAL_STATUSES\.processing/);
  assert.doesNotMatch(approvalService, /prisma\.payment\.create/);
  assert.match(approvalService, /accountingProvider: row\.method === "Cash" \? ACCOUNTING_PROVIDERS\.CASH/);
  assert.match(approvalService, /postApprovedCashTransaction/);
  assert.match(approvalService, /pendingCount[\s\S]*status: "Pending"/);
  assert.doesNotMatch(approvalService, /pendingCount[\s\S]*status: \{ in: \["Pending", "Failed"\] \}/);
  assert.match(bookingService, /if \(method === "Cash"\)[\s\S]*quickBooksStored: false[\s\S]*return hold;/);
  assert.match(invoiceService, /if \(method === "Cash"\)[\s\S]*quickBooksStored: false[\s\S]*return updated;/);
  assert.match(routes, /approvals\/:id\/approve/);
  assert.match(routes, /approvals\/:id\/reject/);
  // A real incident: the same $100 e-transfer for one appointment got
  // submitted three times across different screens before any of them
  // failed or was reviewed. assertNoLivePaymentApproval is the shared
  // guard every entry point calls before starting a new consultation
  // payment attempt — confirmed live (disposable Pending row against a
  // real appointment, guard threw, row deleted) that it actually blocks a
  // second submission while the first is still Pending or Processing.
  assert.match(bookingService, /export async function assertNoLivePaymentApproval\(agencyId, appointmentId\)/);
  assert.match(bookingService, /status: \{ in: \["Pending", "Processing"\] \}/);
  assert.match(bookingService, /await assertNoLivePaymentApproval\(agencyId, appointmentId\);/);
  assert.match(approvalService, /import \{ assertNoLivePaymentApproval,.*\} from "\.\/bookingPaymentHoldService\.js";/);
  assert.match(approvalService, /if \(values\.entryType === "appointment_payment"\) \{\s*\n\s*await assertNoLivePaymentApproval\(agencyId, appointment\.id\);/);
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
