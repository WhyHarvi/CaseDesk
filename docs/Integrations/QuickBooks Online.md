---
type: integration
status: active
risk: critical
---

# QuickBooks Online

## Purpose
Synchronizes clients/customers, billing items/accounts/tax mappings, invoices, payments, voids/refunds, booking payment holds, and reconciliation status with an agency's QuickBooks company.

QuickBooks Online with QuickBooks Payments is also the accepted initial provider for the proposed CaseDesk SaaS commercial billing layer. That platform-owned flow is documented in [[Subscriptions and Entitlements]] and [[SaaS Commercial Billing with QuickBooks]]. It is separate from an agency using its own QuickBooks connection to bill immigration clients.

## Authentication Method
Intuit OAuth 2 authorization code/refresh tokens. Access and refresh tokens are encrypted in `AgencyQuickBooksSettings` with `backend/src/services/secretEncryption.js`; callback state ties agency and user. Webhooks validate the Intuit signature with the configured verifier token.

## Backend
`backend/src/services/quickbooksService.js`, `quickbooksWebhookService.js`, `clientQuickBooksSyncService.js`, `caseInvoiceService.js`, and `paymentScheduleService.js`.

## Routes and Webhooks
`backend/src/routes/quickbooksRoutes.js`, `quickbooksWebhookRoutes.js`; controllers of the same domain. Webhooks are acknowledged after durable `QuickBooksWebhookEvent` insertion and processed asynchronously.

## Database Models
`AgencyQuickBooksSettings`, `QuickBooksWebhookEvent`, [[Client]], [[CaseInvoice]], [[CasePaymentSchedule]], payment/refund/hold/approval models.

## Features Relying On
[[Billing and Payments]], [[Payment Schedules]], [[Clients]], [[Appointments and Booking]], and [[Incentives and Workload]].

## Client Phone Mapping
Client sync maps the CaseDesk primary phone to QuickBooks `PrimaryPhone` and the optional secondary phone to `AlternatePhone`.

## Failure Implications
Token or API failure leaves sync-error/retry state and can delay invoice/payment/refund confirmation. Webhook loss is partly covered by polling/reconciliation safety nets; duplicate processing must stay idempotent.

For future CaseDesk subscription billing, provider downtime must not erase local subscription configuration or pricing. A leased CaseDesk scheduler creates each period's commercial invoice through an adapter, and durable webhook plus polling reconciliation updates the local `SubscriptionInvoice`. QuickBooks does not grant or revoke features directly.

When invoice creation returns a duplicate-document-number fault, CaseDesk queries that exact QuickBooks document number. It reuses a single matching, non-void invoice only after checking customer, total, and hosted-method flags; otherwise it rotates the unfinalized local number and retries once. This reconciles interrupted finalization without duplicating receivables.

Before any funds are received, a client may change the selected payment method. CaseDesk reads the live invoice, requires its provider balance to equal its total, and performs a SyncToken-protected full update of the same QuickBooks invoice to replace its pricing lines and hosted-method flags. It never voids or creates a second receivable for this action; any provider or local payment/refund activity locks the method.

Credit-card and bank-transfer processing fees use dedicated QuickBooks Service items mapped to `Other Income`. When a configured fee has no mapping, CaseDesk first reuses an exact-name active item or provisions the system item and persists both the QuickBooks settings and built-in fee-category mappings. The configured client-facing rate is never suppressed because the item is missing.

## Environment Variables
`QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI`, `QBO_ENVIRONMENT`, `QBO_WEBHOOK_VERIFIER_TOKEN`, `QBO_WEBHOOK_POLL_MS`, `QBO_HOLD_RECONCILE_COOLDOWN_MS`, `MAIL_SETTINGS_ENCRYPTION_KEY`.

The commercial billing implementation will require separately named platform-owned QuickBooks credentials/configuration. It must not silently reuse a customer agency's tenant-scoped `AgencyQuickBooksSettings` connection.
