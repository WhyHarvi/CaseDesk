import { createHttpError } from "../utils/http.js";
import { verifyIntuitWebhookSignature } from "../services/quickbooksService.js";
import { confirmPaymentHold, recordWebhookEvent } from "../services/quickbooksWebhookService.js";

const ENTITY_NAMES = {
  account: "Account",
  bill: "Bill",
  billpayment: "BillPayment",
  budget: "Budget",
  class: "Class",
  creditmemo: "CreditMemo",
  currency: "Currency",
  customer: "Customer",
  department: "Department",
  deposit: "Deposit",
  employee: "Employee",
  estimate: "Estimate",
  invoice: "Invoice",
  item: "Item",
  journalcode: "JournalCode",
  journalentry: "JournalEntry",
  payment: "Payment",
  paymentmethod: "PaymentMethod",
  preferences: "Preferences",
  purchase: "Purchase",
  purchaseorder: "PurchaseOrder",
  refundreceipt: "RefundReceipt",
  salesreceipt: "SalesReceipt",
  taxagency: "TaxAgency",
  term: "Term",
  timeactivity: "TimeActivity",
  transfer: "Transfer",
  vendor: "Vendor",
  vendorcredit: "VendorCredit",
};

const OPERATIONS = {
  create: "Create",
  created: "Create",
  update: "Update",
  updated: "Update",
  delete: "Delete",
  deleted: "Delete",
  merge: "Merge",
  merged: "Merge",
  void: "Void",
  voided: "Void",
  email: "Emailed",
  emailed: "Emailed",
};

function cloudEventEntity(event) {
  const match = /^qbo\.([a-z0-9_-]+)\.([a-z0-9_-]+)\.v\d+$/i.exec(String(event?.type || ""));
  const entityKey = match?.[1]?.toLowerCase().replace(/[-_]/g, "");
  const operationKey = match?.[2]?.toLowerCase();
  const realmId = String(event?.intuitaccountid || "").trim();
  const entityId = String(event?.intuitentityid || "").trim();
  if (!match || !realmId || !entityId) return null;
  return {
    realmId,
    entity: {
      id: entityId,
      name: ENTITY_NAMES[entityKey] || match[1],
      operation: OPERATIONS[operationKey] || match[2],
      lastUpdated: event.time || null,
      rawPayload: event,
    },
  };
}

/**
 * Intuit is migrating QBO webhooks from the legacy eventNotifications
 * wrapper to a CloudEvents array. Keep accepting both formats while
 * connected companies move across independently.
 */
export function normalizeQuickBooksWebhookNotifications(payload) {
  if (Array.isArray(payload)) {
    const byRealm = new Map();
    for (const event of payload) {
      const normalized = cloudEventEntity(event);
      if (!normalized) continue;
      const entities = byRealm.get(normalized.realmId) || [];
      entities.push(normalized.entity);
      byRealm.set(normalized.realmId, entities);
    }
    return [...byRealm].map(([realmId, entities]) => ({ realmId, entities }));
  }

  const notifications = Array.isArray(payload?.eventNotifications) ? payload.eventNotifications : [];
  return notifications
    .map((notification) => ({
      realmId: String(notification?.realmId || "").trim(),
      entities: Array.isArray(notification?.dataChangeEvent?.entities)
        ? notification.dataChangeEvent.entities
        : [],
    }))
    .filter((notification) => notification.realmId && notification.entities.length);
}

// Public, unauthenticated — Intuit calls this directly. Identity/trust
// comes entirely from the HMAC signature, not from any auth header.
export async function receiveQuickBooksWebhook(req, res) {
  const signature = req.get("intuit-signature");
  const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
  if (!verifyIntuitWebhookSignature(rawBody, signature)) {
    throw createHttpError(401, "Invalid webhook signature.", "INVALID_SIGNATURE");
  }

  const notifications = normalizeQuickBooksWebhookNotifications(req.body);
  for (const { realmId, entities } of notifications) {
    // Do not acknowledge a valid notification until it is durable. Intuit
    // will retry a non-2xx response if the database is temporarily down.
    await recordWebhookEvent({ realmId, entities });
  }

  // Ack fast regardless of whether anything matched a known realm — never
  // leak realm validity to an unauthenticated caller via status code. Real
  // processing happens asynchronously in the poll worker.
  res.status(200).json({ received: true });
}

// Dev/staging only — simulates a webhook-confirmed payment for a hold,
// since QuickBooks Payments (and therefore the real card-pay + webhook
// loop) cannot be exercised in the sandbox environment at all.
export async function simulateHoldPayment(req, res) {
  if (process.env.NODE_ENV === "production") {
    throw createHttpError(404, "Not found.", "NOT_FOUND");
  }
  const appointment = await confirmPaymentHold(req.auth.agencyId, req.params.holdId);
  res.json({ data: { confirmed: Boolean(appointment), appointment } });
}
