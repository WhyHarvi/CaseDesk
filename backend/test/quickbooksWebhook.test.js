import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeQuickBooksWebhookNotifications } from "../src/controllers/quickbooksWebhookController.js";
import { microsoftInternetMessageHeaders } from "../src/services/microsoftMailboxService.js";
import { netCollectedAmount, normalizeCaseInvoiceStatus } from "../src/services/paymentsOverviewService.js";

test("QuickBooks webhook normalization retains the legacy payload", () => {
  const payload = {
    eventNotifications: [{
      realmId: "realm-1",
      dataChangeEvent: {
        entities: [{ id: "21", name: "Invoice", operation: "Update" }],
      },
    }],
  };

  assert.deepEqual(normalizeQuickBooksWebhookNotifications(payload), [{
    realmId: "realm-1",
    entities: [{ id: "21", name: "Invoice", operation: "Update" }],
  }]);
});

test("QuickBooks webhook normalization accepts and groups CloudEvents", () => {
  const invoice = {
    specversion: "1.0",
    id: "event-1",
    type: "qbo.invoice.updated.v1",
    time: "2026-07-28T23:30:00.000Z",
    intuitentityid: "21",
    intuitaccountid: "realm-1",
    data: {},
  };
  const payment = {
    specversion: "1.0",
    id: "event-2",
    type: "qbo.payment.created.v1",
    time: "2026-07-28T23:30:01.000Z",
    intuitentityid: "44",
    intuitaccountid: "realm-1",
    data: {},
  };

  const normalized = normalizeQuickBooksWebhookNotifications([invoice, payment]);

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].realmId, "realm-1");
  assert.deepEqual(
    normalized[0].entities.map(({ id, name, operation }) => ({ id, name, operation })),
    [
      { id: "21", name: "Invoice", operation: "Update" },
      { id: "44", name: "Payment", operation: "Create" },
    ],
  );
  assert.equal(normalized[0].entities[0].rawPayload, invoice);
});

test("malformed CloudEvents are ignored without discarding valid events", () => {
  const normalized = normalizeQuickBooksWebhookNotifications([
    { type: "not-qbo", intuitentityid: "1", intuitaccountid: "realm-1" },
    { type: "qbo.invoice.updated.v1", intuitentityid: "21", intuitaccountid: "realm-1" },
  ]);

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].entities.length, 1);
  assert.equal(normalized[0].entities[0].id, "21");
});

test("Microsoft Graph custom headers are omitted when empty and capped at its supported limit", () => {
  assert.deepEqual(microsoftInternetMessageHeaders(undefined), []);
  const headers = Object.fromEntries([
    ["Subject", "ignored"],
    ...Array.from({ length: 7 }, (_, index) => [`X-CaseDesk-${index}`, index]),
  ]);
  const normalized = microsoftInternetMessageHeaders(headers);
  assert.equal(normalized.length, 5);
  assert.ok(normalized.every(({ name }) => name.startsWith("X-CaseDesk-")));
});

test("voided and refunded transactions are never presented or totalled as paid", () => {
  assert.equal(normalizeCaseInvoiceStatus("Void"), "Voided");
  assert.equal(netCollectedAmount({ status: "Voided", amount: 500, balance: 0 }), 0);
  assert.equal(netCollectedAmount({ status: "Refunded", amount: 100, balance: 0 }), 0);
  assert.equal(netCollectedAmount({ status: "Paid", amount: 100, balance: 0 }), 100);
});

test("paid booking holds have a missed-webhook reconciliation path before expiry and void", async () => {
  const [publicController, holdService, webhookService, quickBooksService, paymentsPage] = await Promise.all([
    readFile(new URL("../src/controllers/publicBookingController.js", import.meta.url), "utf8"),
    readFile(new URL("../src/services/bookingPaymentHoldService.js", import.meta.url), "utf8"),
    readFile(new URL("../src/services/quickbooksWebhookService.js", import.meta.url), "utf8"),
    readFile(new URL("../src/services/quickbooksService.js", import.meta.url), "utf8"),
    readFile(new URL("../../frontend/src/pages/Payments.jsx", import.meta.url), "utf8"),
  ]);

  assert.match(publicController, /reconcilePaymentHold\(settings\.agencyId, hold\.id, \{ allowExpired: true \}\)/);
  assert.match(holdService, /pre_expiry_reconcile_failed/);
  assert.match(holdService, /pre_void_reconcile_failed/);
  assert.match(webhookService, /invoice\.balance > 0/);
  assert.match(webhookService, /status: "AwaitingPayment", nextVoidAttemptAt: null/);
  assert.match(quickBooksService, /path: "\/invoice\?operation=void"/);
  assert.doesNotMatch(quickBooksService, /path: "\/invoice\?operation=delete"/);
  assert.match(webhookService, /event\.entityName === "RefundReceipt"/);
  assert.match(paymentsPage, /row\.status === "Voided"[\s\S]*Not collected/);
  assert.match(paymentsPage, /row\.status === "Refunded"[\s\S]*Refunded/);
});
