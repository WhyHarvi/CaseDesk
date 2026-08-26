import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("a mistakenly-recorded payment can be reversed without a refund — deleted in QuickBooks, never voided as a card charge", async () => {
  const [quickbooksService, invoiceService, invoiceController, caseRoutes, scheduleService, billingWorkspace] = await Promise.all([
    source("../src/services/quickbooksService.js"),
    source("../src/services/caseInvoiceService.js"),
    source("../src/controllers/caseInvoiceController.js"),
    source("../src/routes/caseRoutes.js"),
    source("../src/services/paymentScheduleService.js"),
    source("../../frontend/src/components/case-profile/CaseBillingWorkspace.jsx"),
  ]);

  // Real incident: a single e-transfer got recorded as two separate paid
  // invoices. QuickBooks' own Payment void operation turned out to be
  // credit-card-only — tested live against a real e-transfer payment, it
  // rejected with "You can't void this credit card amount...". Deleting
  // the transaction is QuickBooks' actual mechanism for a non-card
  // payment that should never have posted; it is not a refund (no money
  // moves), unlike requestCaseInvoiceRefund.
  assert.match(quickbooksService, /export async function deleteQuickBooksPayment\(agencyId, \{ id \}\)/);
  assert.match(quickbooksService, /path: "\/payment\?operation=delete"/);
  assert.doesNotMatch(quickbooksService, /path: "\/payment\?operation=void"/);

  assert.match(invoiceService, /export async function voidPaidCaseInvoicePayment\(agencyId, \{ caseId, invoiceId, reason, actorUserId \}\)/);
  assert.match(invoiceService, /if \(invoice\.refunds\.length\) \{/);
  assert.match(invoiceService, /REFUND_ALREADY_EXISTS/);
  assert.match(invoiceService, /await deleteQuickBooksPayment\(agencyId, \{ id: invoice\.lastQbPaymentId \}\);/);
  // Deleting the payment changes the invoice's own SyncToken in
  // QuickBooks — voiding the invoice with the stale token CaseDesk has on
  // file would fail, so it must be re-read first.
  assert.match(invoiceService, /const freshInvoice = await getQuickBooksInvoice\(agencyId, invoice\.qbInvoiceId\);/);

  assert.match(invoiceController, /export async function voidInvoicePayment\(req, res\)/);
  assert.match(caseRoutes, /"\/:id\/invoices\/:invoiceId\/void-payment"/);
  assert.match(caseRoutes, /requireRole\("admin"\),\s*\n\s*rateLimit\(\{ windowMs: 60_000, max: 20 \}\),\s*\n\s*asyncHandler\(voidInvoicePayment\)/);

  // A payment-schedule installment's invoice needs the same reversal, plus
  // resetting the installment back to Scheduled so the schedule doesn't
  // stay pointed at a voided invoice.
  assert.match(scheduleService, /await deleteQuickBooksPayment\(agencyId, \{ id: invoice\.lastQbPaymentId \}\);/);
  assert.match(scheduleService, /status: "Scheduled",[\s\S]*caseInvoiceId: null,[\s\S]*invoicedAt: null,[\s\S]*lastInvoiceError: null/);

  assert.match(billingWorkspace, /Void payment \(mistaken entry\)/);
  assert.match(billingWorkspace, /voidCaseInvoicePayment/);
  assert.match(billingWorkspace, /invoicedInstallment/);
});

test("a voided payment's old reference doesn't permanently lock out its own real transaction number", async () => {
  const [invoiceService, holdService] = await Promise.all([
    source("../src/services/caseInvoiceService.js"),
    source("../src/services/bookingPaymentHoldService.js"),
  ]);

  // Real regression: after voiding the two mistaken invoices above, trying
  // to record the real payment against the replacement invoice with the
  // same real transaction number failed with "This transaction number is
  // already attached to another payment" — the duplicate check was
  // matching the now-voided invoices' preserved reference history. Voided
  // rows keep their reference for audit purposes but no longer represent
  // an active payment, so the duplicate check must exclude them.
  assert.match(invoiceService, /prisma\.caseInvoice\.findFirst\(\{ where: \{ agencyId, lastPaymentReference: paymentReference, status: \{ notIn: \["Void", "Voided"\] \} \}, select: \{ id: true \} \}\),/);
  assert.match(invoiceService, /prisma\.bookingPaymentHold\.findFirst\(\{ where: \{ agencyId, manualPaymentReference: paymentReference, status: \{ notIn: \["Void", "Voided"\] \} \}, select: \{ id: true \} \}\),/);

  // The same duplicate-check pattern is duplicated (not shared) in the
  // booking payment hold flow, at two separate call sites (recording a
  // walk-in payment, and editing an already-paid hold's transaction
  // details) — each checks both a bookingPaymentHold row and a caseInvoice
  // row, so both needed the same status exclusion, 4 filters total.
  const duplicateCheckCount = (holdService.match(/status: \{ notIn: \["Void", "Voided"\] \}/g) || []).length;
  assert.equal(duplicateCheckCount, 4);
});
