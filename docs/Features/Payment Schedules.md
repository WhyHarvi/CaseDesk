---
type: feature
status: active
risk: critical
---

# Payment Schedules

## Purpose
Defines reusable installment templates and case-specific schedules that generate or reconcile invoice installments over time.

## Depends On
- [[Billing and Payments]]
- [[Cases]]
- [[QuickBooks Online]]

## Used By
[[Client Portal]], case billing, payment notifications, and lifecycle review.

## Database Models
[[CasePaymentSchedule]], `CasePaymentInstallment`, `PaymentScheduleTemplate`, and `PaymentScheduleTemplateInstallment`.

## Backend
`backend/src/routes/paymentScheduleRoutes.js`, `backend/src/controllers/paymentScheduleController.js`, `backend/src/services/paymentScheduleService.js`, and `paymentNotificationService.js`. A worker starts in `backend/src/server.js`.

## Frontend
`frontend/src/components/case-profile/CasePaymentScheduleWorkspace.jsx`, `frontend/src/components/payments/InstallmentListEditor.jsx`, `frontend/src/api/paymentScheduleApi.js`, and the payment-schedule settings card.

## Integrations
[[QuickBooks Online]] and [[SMTP and IMAP]].

## Business Rules
One schedule is attached to a case. Installment ordering, due amounts, invoice links/status, and retries must stay consistent; failed invoice creation cannot silently advance the installment.

## Permissions
Requires financial capability and Payments/Billing access; template management is administrative.

## Side Effects
Creates invoices, sends notifications, and may void QuickBooks payments/invoices during corrective operations.

## Change Risk
Critical because worker retries and external calls can duplicate or omit charges.

## Tests
`backend/test/paymentScheduleInvoiceFailure.test.js` and `backend/test/caseBillingRetainerScheduleAwareness.test.js`.
