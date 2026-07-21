import { createHttpError } from "../utils/http.js";
import { verifyIntuitWebhookSignature } from "../services/quickbooksService.js";
import { confirmPaymentHold, recordWebhookEvent } from "../services/quickbooksWebhookService.js";

// Public, unauthenticated — Intuit calls this directly. Identity/trust
// comes entirely from the HMAC signature, not from any auth header.
export async function receiveQuickBooksWebhook(req, res) {
  const signature = req.get("intuit-signature");
  const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
  if (!verifyIntuitWebhookSignature(rawBody, signature)) {
    throw createHttpError(401, "Invalid webhook signature.", "INVALID_SIGNATURE");
  }

  const notifications = Array.isArray(req.body?.eventNotifications) ? req.body.eventNotifications : [];
  for (const notification of notifications) {
    const realmId = String(notification.realmId || "");
    const entities = notification.dataChangeEvent?.entities || [];
    if (!realmId || !entities.length) continue;
    await recordWebhookEvent({ realmId, entities }).catch(() => {});
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
