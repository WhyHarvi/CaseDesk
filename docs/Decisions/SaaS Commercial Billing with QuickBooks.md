---
type: decision
status: accepted
risk: critical
---

# SaaS Commercial Billing with QuickBooks

## Decision

QuickBooks Online with QuickBooks Payments is the initial billing provider for CaseDesk workspace subscriptions.

CaseDesk owns product configuration, price calculation, subscription state, feature entitlements, limits, add-ons, promotions, seats, usage, grace periods, and access decisions. QuickBooks owns the external accounting customer, invoice/payment presentation, payment processing, and accounting record.

All QuickBooks operations sit behind a billing-provider adapter. Provider identifiers and status snapshots are stored on CaseDesk commercial billing records, but no entitlement decision reads plan or feature configuration from QuickBooks. This preserves future support for manual billing, Stripe, Paddle, or another provider.

## Billing Schedule

CaseDesk will generate the subscription invoice for each billing period instead of making a static QuickBooks recurring template the primary scheduler. This allows the amount and invoice lines to reflect the current plan, add-ons, extra seats, promotions, and metered usage.

QuickBooks recurring invoice or autopay capabilities may be used later when a fixed agreement and the connected QuickBooks account support them. They are an optional provider capability, not the CaseDesk subscription engine.

## Payment Reconciliation

QuickBooks webhooks enter the existing signed, durable webhook pattern. CaseDesk acknowledges a durably stored event, then asynchronously verifies the live QuickBooks entity before changing the local commercial invoice or subscription state. Polling reconciliation remains a recovery path.

A paid and verified commercial invoice activates a pending subscription or clears its past-due state. An unpaid invoice follows the configured warning and grace policy and may ultimately place the workspace in read-only access. No billing status deletes customer data.

## Boundaries

- Existing `CaseInvoice`, payment schedule, cash ledger, refund, and client portal payment workflows continue to represent agency-to-client billing.
- New `SubscriptionInvoice` records represent CaseDesk-to-agency billing.
- Provider transaction fees and capabilities are configuration/current-provider concerns; they must not be hard-coded into entitlement or plan logic.
- A workspace's own QuickBooks connection is not implicitly the same connection CaseDesk uses to bill that workspace. Commercial provider credentials and realm/company identity require a platform-owned configuration boundary.

## Consequences

- CaseDesk needs a leased, idempotent commercial billing scheduler and a separate provider adapter/configuration.
- Commercial invoice lines require immutable pricing snapshots for audit and reconciliation.
- QuickBooks customer/invoice/payment identifiers must be unique within the platform billing realm.
- Subscription access remains functional if QuickBooks is temporarily unavailable; reconciliation catches up without duplicate invoices or access oscillation.
- The Platform Admin UI must expose reconciliation state and safe retry controls without exposing credentials or provider costs to customer workspaces.

## Related

[[Subscriptions and Entitlements]] · [[QuickBooks Online]] · [[Billing and Payments]] · [[Multi-Tenancy]]

## Provider References

- [Create invoices in QuickBooks Online](https://quickbooks.intuit.com/learn-support/en-ca/help-article/invoicing/create-invoices-quickbooks-online/L7gSzvCld_CA_en_CA)
- [Create recurring invoices and transactions](https://quickbooks.intuit.com/learn-support/en-us/help-article/recurring-transactions/create-recurring-transactions-quickbooks-online/L3WoKX2R8_US_en_US)
- [Set up Autopay for recurring invoices](https://quickbooks.intuit.com/learn-support/en-us/help-article/invoicing/set-autopay-recurring-invoices-quickbooks-online/L4R4t6gVS_US_en_US)

Provider functionality, availability, limits, and pricing must be revalidated during implementation instead of being encoded as permanent CaseDesk assumptions.
