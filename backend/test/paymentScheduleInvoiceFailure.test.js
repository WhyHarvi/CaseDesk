import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildQuickBooksInvoiceLines } from "../src/services/quickbooksService.js";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("after-tax fixed discounts are explicitly non-taxable in QuickBooks", () => {
  const lines = buildQuickBooksInvoiceLines({
    invoiceLines: [{ itemId: "services", description: "Initial Payment", amount: 500, taxable: true }],
    taxableTaxCodeId: "hst-on",
    nonTaxableTaxCodeId: "out-of-scope",
    discountAmount: 65,
  });

  assert.deepEqual(lines, [
    {
      Amount: 500,
      DetailType: "SalesItemLineDetail",
      Description: "Initial Payment",
      SalesItemLineDetail: {
        ItemRef: { value: "services" },
        Qty: 1,
        UnitPrice: 500,
        TaxCodeRef: { value: "hst-on" },
      },
    },
    {
      Amount: -65,
      DetailType: "SalesItemLineDetail",
      Description: "Agreed fee discount",
      SalesItemLineDetail: {
        ItemRef: { value: "services" },
        Qty: 1,
        UnitPrice: -65,
        TaxCodeRef: { value: "out-of-scope" },
      },
    },
  ]);

  const taxableBase = lines
    .filter((line) => line.SalesItemLineDetail?.TaxCodeRef?.value === "hst-on")
    .reduce((sum, line) => sum + line.Amount, 0);
  const preTaxTotal = lines.reduce((sum, line) => sum + line.Amount, 0);
  assert.equal(taxableBase, 500);
  assert.equal(preTaxTotal + taxableBase * 0.13, 500);
});

test("discounted invoices fail before posting when QuickBooks has no non-taxable code", async () => {
  const quickBooksService = await source("../src/services/quickbooksService.js");

  assert.match(quickBooksService, /fixedDiscount > 0 && !nonTaxableCodeId/);
  assert.match(quickBooksService, /QBO_NON_TAXABLE_CODE_REQUIRED/);
  assert.match(quickBooksService, /before CaseDesk can apply an after-tax discount/);
});

test("scheduled invoice failures persist and are exposed with an explicit retry", async () => {
  const [schema, service, controller, routes, api, workspace] = await Promise.all([
    source("../prisma/schema.prisma"),
    source("../src/services/paymentScheduleService.js"),
    source("../src/controllers/paymentScheduleController.js"),
    source("../src/routes/caseRoutes.js"),
    source("../../frontend/src/api/paymentScheduleApi.js"),
    source("../../frontend/src/components/case-profile/CasePaymentScheduleWorkspace.jsx"),
  ]);

  assert.match(schema, /lastInvoiceError\s+String\?/);
  assert.match(schema, /lastInvoiceAttemptedAt\s+DateTime\?/);
  assert.match(service, /lastInvoiceError: failureMessage/);
  assert.match(service, /export async function retryScheduledInstallment/);
  assert.match(controller, /export async function retryInstallmentInvoice/);
  assert.match(routes, /installments\/:installmentId\/retry/);
  assert.match(api, /export async function retryInstallmentInvoice/);
  assert.match(workspace, /Invoice could not be issued/);
  assert.match(workspace, /Retry invoice/);
  assert.match(workspace, /Issue invoice now/);
  assert.match(workspace, /installmentIsDue/);
});
