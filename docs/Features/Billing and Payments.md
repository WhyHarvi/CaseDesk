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

Staff-created QuickBooks invoices begin as local `AwaitingPaymentMethod` records containing the base charge, tax, and discount. The client can choose credit card or QuickBooks bank transfer; CaseDesk then creates the real QuickBooks invoice in place, adds the configured method-specific fee, and enables only that hosted method. The portal always discloses the configured rates. If a dedicated processing-fee item is missing, CaseDesk reuses an exact-name active QuickBooks item or creates the system item under an active `Other Income` account and persists the mapping before invoicing. `CardSurcharge` and `BankTransferFee` categories are system-owned outputs of this choice and cannot be selected as the base payment type. Payment-schedule installments use the same deferred-choice flow.

A payment-method choice is reversible while the invoice remains fully unpaid and has no refund or approved payment activity. CaseDesk updates the same QuickBooks invoice in place, recalculates from the original subtotal, tax, and discount, replaces the processing-fee line and hosted-method flags, clears superseded manual evidence, and retains the invoice number and provider identity. Both the portal preview and provider update use that immutable base amount, never a balance that already contains a prior method's fee, so changing from credit card to Interac restores the original total instead of compounding fees. Any payment or partial payment locks the method to protect accounting history.

The client may instead choose Interac e-Transfer, debit, or another offline arrangement. CaseDesk creates the base QuickBooks invoice without a processing fee or hosted payment method and stores the submitted transaction/reference number and optional screenshot separately from confirmed-payment fields. This evidence never changes the balance. Staff must verify receipt and use the existing audited record-payment action; online payments remain automatically matched through QuickBooks.

QuickBooks invoice creation is recoverable when the provider reports that a CaseDesk document number already exists. CaseDesk first reads that provider invoice and adopts it only when the customer, total, payment-method flags, and non-void state match the local draft—covering a provider success followed by an interrupted local response. A genuinely unrelated collision rotates the still-unfinalized local number and retries once; it never creates a second receivable when the existing provider invoice matches.

The unified client ledger identifies a QuickBooks receivable by provider transaction ID and, during an interrupted finalization before that ID is saved locally, by the exact QuickBooks document number, total, client, and void state. The local CaseDesk entry remains the displayed source and the matching provider entry supplies payment allocations without adding a second charge. A number collision with a different total or state remains visible for investigation. Already-prefixed document numbers are displayed unchanged.

## Permissions
Requires financial capability and Payments page or Billing case tab. In a case Billing workspace, record-payment actions are available to administrators, managers, and the case's assigned RCIC or Case Worker; the existing approval flow still applies when a front-desk Case Worker submits an entry. Sensitive approvals and configuration add admin/role rules; all records remain agency/case scoped.

## Side Effects
Creates/voids provider transactions, changes balances, generates PDFs, sends payment notices, and credits/recalculates incentives. Completed collections in explicitly eligible fee categories also append revenue-contest credits; partial/full refunds append capped proportional reversals against the original owner and incentive period. College, government, and disbursement categories are excluded by default.

Voiding a mistaken payment (`voidPaidCaseInvoicePayment`, and its payment-schedule-installment counterpart `voidInvoicedInstallment`) is deliberately not a refund — it deletes the QuickBooks Receive Payment and voids the invoice with no money moving — but the payment may have already run through `creditCaseInvoiceCollection` like any other genuine collection. Both call sites reverse whatever that already posted (incentive ledger credit and revenue-contest credit) in the same transaction as the invoice-status flip, via `incentiveCreditingService.reverseCaseInvoiceRefund`, and rebaseline the credit cursor to 0 there too. See [[Incentive Expansion Requirements]].

## Change Risk
Critical: errors affect money, auditability, external accounting, and case closure.

## Tests
`backend/test/paymentApprovalWorkflow.test.js`, `caseInvoicePaymentValidation.test.js`, `voidPaidInvoicePayment.test.js`, `cashWithdrawal.test.js`, `twoLedgerBilling.test.js`, `accountStatementService.test.js`, and `caseClosureBillingReview.test.js`.
