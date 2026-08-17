import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("billing schema separates QuickBooks from CaseDesk Cash and supports daily closings", async () => {
  const [schema, migration] = await Promise.all([
    read("prisma/schema.prisma"),
    read("prisma/migrations/20260812010000_universal_invoice_cash_ledger/migration.sql"),
  ]);
  assert.match(schema, /model CashTransaction/);
  assert.match(schema, /model CashAllocation/);
  assert.match(schema, /model CashReconciliation/);
  assert.match(schema, /model InvoiceRefund/);
  assert.match(migration, /CREATE TABLE "cash_reconciliations"/);
  assert.match(migration, /cash_reconciliations_staff/);
});

test("consultation invoices go out at the advertised amount, non-taxable, without requiring a QuickBooks tax-code mapping", async () => {
  const [quickBooks, booking] = await Promise.all([
    read("src/services/quickbooksService.js"),
    read("src/services/bookingPaymentHoldService.js"),
  ]);
  // Requiring a tax-code mapping before any consultation invoice could be
  // created (QBO_TAX_MAPPING_REQUIRED) blocked public booking outright for
  // any agency that hasn't picked one — including agencies whose QuickBooks
  // company uses Automated Sales Tax, which doesn't expose a manual
  // tax-code list at all. Reverted to the original behavior: a plain,
  // non-taxable invoice at exactly the advertised amount.
  assert.doesNotMatch(quickBooks, /QBO_TAX_MAPPING_REQUIRED/);
  assert.match(quickBooks, /QBO_INVOICE_TOTAL_MISMATCH/);
  assert.match(quickBooks, /return createQuickBooksInvoice\(agencyId, values\);/);
  assert.match(booking, /createQuickBooksConsultationInvoice/);
  assert.doesNotMatch(booking, /createQuickBooksInvoice/);
});

test("a non-taxable invoice line still carries an explicit QuickBooks tax code once the company has real sales-tax tracking on", async () => {
  const quickBooks = await read("src/services/quickbooksService.js");
  // Regression: omitting TaxCodeRef entirely used to be how a line was
  // marked non-taxable, and that was correct for a QuickBooks company with
  // no sales-tax setup at all. But once a company turns on real sales-tax
  // tracking (its own TaxAgency/TaxCode/TaxRate records exist), QuickBooks
  // starts rejecting any line with no TaxCodeRef — "Make sure all your
  // transactions have a GST/HST rate before you save" — even when the item
  // and customer are both already marked non-taxable. Confirmed live
  // against CHK's real QuickBooks company (which enabled sales tax on
  // 2026-08-17): reproduced the failure with no TaxCodeRef, confirmed the
  // fix with an explicit "Out of Scope" code, then confirmed the real
  // createQuickBooksConsultationInvoice call path succeeds end to end.
  assert.match(quickBooks, /export async function resolveNonTaxableTaxCodeId\(agencyId\)/);
  assert.match(quickBooks, /"Out of Scope", "Zero-rated", "Exempt"/);
  assert.match(quickBooks, /const nonTaxableCodeId = needsNonTaxableCode \? await resolveNonTaxableTaxCodeId\(agencyId\) : null;/);
  assert.match(quickBooks, /const taxCodeId = line\.taxable && taxableTaxCodeId \? taxableTaxCodeId : nonTaxableCodeId;/);
  assert.match(quickBooks, /\.\.\.\(taxCodeId \? \{ TaxCodeRef: \{ value: taxCodeId \} \} : \{\}\),/);
  // A company with sales tax never configured at all has no TaxCode rows to
  // resolve — resolveNonTaxableTaxCodeId returns null and TaxCodeRef is
  // still omitted, so that original (already-fixed) scenario doesn't regress.
  assert.match(quickBooks, /if \(!codes\.length\) return null;/);
});

test("Payments exposes combined ledgers, approvals, historical review and cash closing", async () => {
  const [service, routes, page] = await Promise.all([
    read("src/services/paymentsOverviewService.js"),
    read("src/routes/paymentsOverviewRoutes.js"),
    read("../frontend/src/pages/Payments.jsx"),
  ]);
  assert.match(service, /"casedesk_cash"/);
  assert.match(service, /"quickbooks"/);
  assert.match(routes, /\/cash-closing/);
  assert.match(page, /Payment approvals/);
  assert.match(page, /Historical ledger review/);
  assert.match(page, /CaseDesk Cash closing/);
});

test("staff payment selectors expose only card, e-transfer and cash while legacy methods remain backend-compatible", async () => {
  const [calendar, clientEntry, caseBilling, booking, holdService] = await Promise.all([
    read("../frontend/src/pages/CalendarPage.jsx"),
    read("../frontend/src/components/clients/ClientManualBillingEntrySheet.jsx"),
    read("../frontend/src/components/case-profile/CaseBillingWorkspace.jsx"),
    read("src/controllers/bookingController.js"),
    read("src/services/bookingPaymentHoldService.js"),
  ]);
  const selectorSource = `${calendar}\n${clientEntry}\n${caseBilling}`;
  assert.match(calendar, /\[\["Card", "Card"\], \["ETransfer", "E-transfer"\], \["Cash", "Cash"\]/);
  assert.match(calendar, /Collect consultation payment/);
  assert.match(clientEntry, /PAYMENT_METHODS = \[\["ETransfer", "E-transfer"\], \["Cash", "Cash"\]\]/);
  assert.doesNotMatch(selectorSource, /\["Cheque",|\["Wire",|\["Debit",|\["BankDraft",/);
  assert.match(booking, /"Cheque", "Wire", "Debit", "BankDraft"/);
  assert.match(holdService, /Cheque: "Cheque"[\s\S]*Wire: "Wire transfer"[\s\S]*Debit: "Debit"[\s\S]*BankDraft: "Bank draft"/);
});
