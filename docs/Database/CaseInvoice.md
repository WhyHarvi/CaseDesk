---
type: database-model
status: active
risk: critical
---

# CaseInvoice

## Purpose
Durable CaseDesk invoice independent of whether it is mirrored to QuickBooks or a custom/cash ledger.

## Important Fields
Tenant/case/client, provider/ledger, agency/client snapshots, invoice numbers, decimal subtotal/discount/tax/amount/balance, status/due/payment data, QuickBooks IDs/token/link, and idempotency keys.

## Relationships
Belongs to [[Agency]], [[Case]], [[Client]], optional ledger/creator; owns lines, installments, approvals, cash allocations, refunds, follow-ups, and incentive records.

## Features and Services
[[Billing and Payments]], [[Payment Schedules]], [[Client Portal]], [[QuickBooks Online]], and [[Incentives and Workload]]. Modified by invoice, approval, ledger, payment-schedule, QuickBooks webhook, and incentive services.

## Deletion and Rules
Case/client/agency deletion cascades financial history. Provider ID, invoice number, creation, and last-payment idempotency are agency-unique. Snapshots preserve issued identity; Decimal arithmetic and provider sync tokens must remain exact.
