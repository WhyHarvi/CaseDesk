import test from "node:test";
import assert from "node:assert/strict";
import { buildLedgerFromPayments, buildUnifiedClientLedger } from "../src/services/accountStatementService.js";
import { generateAccountStatementPdf } from "../src/services/accountStatementPdfService.js";

const payment = (overrides = {}) => ({
  id: "11111111-2222-3333-4444-555555555555",
  caseId: "case-1",
  totalFee: 1000,
  paidAmount: 300,
  balance: 700,
  status: "Partial",
  notes: "Professional services",
  createdAt: new Date("2026-01-10T12:00:00Z"),
  updatedAt: new Date("2026-01-10T12:00:00Z"),
  ...overrides,
});

test("builds charges and payments from a saved billing record", () => {
  const result = buildLedgerFromPayments([payment()], { caseReferences: { "case-1": "Study Permit" } });
  assert.equal(result.transactions.length, 2);
  assert.deepEqual(result.summary, {
    openingBalance: 0,
    totalCharges: 1000,
    totalPayments: 300,
    totalCredits: 0,
    totalRefunds: 0,
    netCollected: 300,
    totalAdjustments: 0,
    closingBalance: 700,
  });
  assert.equal(result.transactions.at(-1).runningBalance, 700);
});

test("shows a refunded payment as a reversal without reducing the amount owed", () => {
  const result = buildLedgerFromPayments([payment({ totalFee: 500, paidAmount: 500, balance: 500, status: "Refunded", updatedAt: new Date("2026-01-12T12:00:00Z") })]);
  assert.equal(result.summary.totalPayments, 500);
  assert.equal(result.summary.totalRefunds, 500);
  assert.equal(result.summary.closingBalance, 500);
  assert.equal(result.transactions.some((entry) => entry.type === "Refund"), true);
});

test("calculates opening balance and period totals without duplicating earlier transactions", () => {
  const result = buildLedgerFromPayments([
    payment({ id: "before", totalFee: 200, paidAmount: 0, balance: 200, createdAt: new Date("2025-12-01T12:00:00Z") }),
    payment({ id: "during", totalFee: 400, paidAmount: 100, balance: 300, createdAt: new Date("2026-02-01T12:00:00Z") }),
  ], { from: new Date("2026-01-01T00:00:00Z"), to: new Date("2026-12-31T23:59:59Z") });
  assert.equal(result.summary.openingBalance, 200);
  assert.equal(result.summary.totalCharges, 400);
  assert.equal(result.summary.totalPayments, 100);
  assert.equal(result.summary.closingBalance, 500);
});

test("ties a persisted balance difference to its saved billing record as an adjustment", () => {
  const result = buildLedgerFromPayments([payment({ totalFee: 100, paidAmount: 0, balance: 80 })]);
  assert.equal(result.summary.totalAdjustments, -20);
  assert.equal(result.summary.closingBalance, 80);
  assert.equal(result.transactions.at(-1).type, "Adjustment");
});

test("creates a valid PDF for an empty statement", async () => {
  const statement = {
    statementNumber: "SOA-2026-000001",
    generatedAt: new Date("2026-07-14T12:00:00Z"),
    period: { from: null, to: null },
    currency: "CAD",
    agency: { name: "CaseDesk Immigration", locale: "en-CA", timezone: "America/Toronto" },
    client: { id: "client-1", fullName: "Test Client" },
    case: null,
    transactions: [],
    summary: { openingBalance: 0, totalCharges: 0, totalPayments: 0, totalCredits: 0, totalRefunds: 0, totalAdjustments: 0, closingBalance: 0 },
  };
  const pdf = await generateAccountStatementPdf(statement);
  assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
  assert.ok(pdf.length > 1000);
});

test("uses exact QuickBooks payment allocations without duplicating the cached invoice payment", () => {
  const result = buildUnifiedClientLedger({
    caseInvoices: [{
      id: "case-invoice-1", caseId: "case-1", qbInvoiceId: "42", qbInvoiceNumber: "1006",
      description: "Professional fees", amount: 100, balance: 0, status: "Paid",
      createdAt: new Date("2026-07-30T20:00:00Z"), updatedAt: new Date("2026-07-30T21:00:00Z"),
    }],
    quickBooksPayments: [{
      id: "43", totalAmount: 100, createdAt: new Date("2026-07-30T21:13:18Z"),
      allocations: [{ invoiceId: "42", amount: 100 }],
    }],
  }, { caseReferences: { "case-1": "Visitor Visa" } });

  assert.equal(result.summary.totalCharges, 100);
  assert.equal(result.summary.totalPayments, 100);
  assert.equal(result.summary.closingBalance, 0);
  assert.equal(result.transactions.filter((entry) => entry.type === "Payment").length, 1);
  assert.equal(result.transactions.find((entry) => entry.type === "Payment").reference, "QBP-43");
});

test("reports a consultation payment and refund without reopening the paid invoice balance", () => {
  const result = buildUnifiedClientLedger({
    bookingPayments: [{
      id: "hold-1", qbInvoiceId: "42", qbInvoiceNumber: "1006", qbRefundReceiptId: "77",
      guestName: "Client", amount: 100, status: "Refunded",
      createdAt: new Date("2026-07-30T20:00:00Z"), paidAt: new Date("2026-07-30T21:00:00Z"), updatedAt: new Date("2026-07-31T16:00:00Z"),
      appointment: { subject: "Initial Consultation", startsAt: new Date("2026-08-04T14:00:00Z") },
    }],
    quickBooksPayments: [{ id: "43", totalAmount: 100, createdAt: new Date("2026-07-30T21:00:00Z"), allocations: [{ invoiceId: "42", amount: 100 }] }],
    quickBooksRefunds: [{ id: "77", totalAmount: 100, createdAt: new Date("2026-07-31T16:00:00Z") }],
  });

  assert.equal(result.summary.totalCharges, 100);
  assert.equal(result.summary.totalPayments, 100);
  assert.equal(result.summary.totalRefunds, 100);
  assert.equal(result.summary.netCollected, 0);
  assert.equal(result.summary.closingBalance, 0);
  assert.equal(result.transactions.find((entry) => entry.type === "Refund").refund, 100);
});
