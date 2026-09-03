---
type: feature
status: active
risk: critical
---

# Billing and Payments

## Purpose
Maintains case invoices and lines, legacy payments, cash transactions/allocations/reconciliation, refunds, manual/custom ledgers, account statements, billing settings, retainers, and approval-controlled money operations.

## Depends On
- [[Cases]]
- [[Clients]]
- [[Authorization]]
- [[QuickBooks Online]]

## Used By
[[Payment Schedules]], [[Client Portal]], [[Incentives and Workload]], [[Notifications]], and case lifecycle closing checks.

## Database Models
[[CaseInvoice]], [[Payment]], `CaseInvoiceLine`, `CashTransaction`, `CashAllocation`, `CashReconciliation`, `InvoiceRefund`, `PaymentApproval`, `CaseManualLedgerEntry`, `AgencyCustomPaymentLedger`, `AccountStatementGeneration`, `AgencyBillingSettings`, and `AgencyFeeCategory`.

## Backend
Financial route/controller families include `paymentRoutes.js`, `paymentsOverviewRoutes.js`, `caseBillingRetainerRoutes.js`, `agencyBillingSettingsRoutes.js`, and `feeCategoryRoutes.js`. Core services include `caseInvoiceService.js`, `paymentApprovalService.js`, `paymentApprovalLedgerService.js`, `customPaymentLedgerService.js`, `accountStatementService.js`, and QuickBooks services.

## Frontend
`frontend/src/pages/Payments.jsx`, `frontend/src/components/case-profile/CaseBillingWorkspace.jsx`, `frontend/src/components/ledger/`, `frontend/src/components/statements/`, and financial API clients under `frontend/src/api/`.

## Integrations
[[QuickBooks Online]], [[SMTP and IMAP]], and [[Supabase]] storage for statement/invoice PDFs.

## Business Rules
Invoice totals, allocations, balances, refund/void ordering, tax/item mappings, two-ledger display, and approval status must remain consistent. Paid invoice mutation is validated. External failures are recorded for reconciliation.

## Permissions
Requires financial capability and Payments page or Billing case tab. Sensitive approvals and configuration add admin/role rules; all records remain agency/case scoped.

## Side Effects
Creates/voids provider transactions, changes balances, generates PDFs, sends payment notices, and credits/recalculates incentives. Completed collections in explicitly eligible fee categories also append revenue-contest credits; partial/full refunds append capped proportional reversals against the original owner and incentive period. College, government, and disbursement categories are excluded by default.

## Change Risk
Critical: errors affect money, auditability, external accounting, and case closure.

## Tests
`backend/test/paymentApprovalWorkflow.test.js`, `caseInvoicePaymentValidation.test.js`, `voidPaidInvoicePayment.test.js`, `cashWithdrawal.test.js`, `twoLedgerBilling.test.js`, `accountStatementService.test.js`, and `caseClosureBillingReview.test.js`.
