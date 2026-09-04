---
type: integration
status: active
risk: critical
---

# QuickBooks Online

## Purpose
Synchronizes clients/customers, billing items/accounts/tax mappings, invoices, payments, voids/refunds, booking payment holds, and reconciliation status with an agency's QuickBooks company.

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

## Environment Variables
`QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI`, `QBO_ENVIRONMENT`, `QBO_WEBHOOK_VERIFIER_TOKEN`, `QBO_WEBHOOK_POLL_MS`, `QBO_HOLD_RECONCILE_COOLDOWN_MS`, `MAIL_SETTINGS_ENCRYPTION_KEY`.
