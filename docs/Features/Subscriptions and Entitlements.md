---
type: feature
status: active
risk: critical
---

# Subscriptions and Entitlements

## Purpose

Defines the CaseDesk commercial layer for editable plans, modules, feature entitlements, limits, add-ons, custom agreements, seats, trials, promotions, metered usage, subscription invoices, and partner revenue. [[Agency]] remains the workspace/tenant. CaseDesk remains authoritative for subscription configuration, pricing, status, and application access.

## Depends On

- [[Authentication]]
- [[Authorization]]
- [[Multi-Tenancy]]
- [[Users and Onboarding]]
- [[QuickBooks Online]]

## Separation of Responsibilities

```text
CaseDesk subscription engine
  -> calculates prices and billing-period charges
  -> owns subscription state, plans, add-ons, limits, and entitlements
  -> creates a commercial invoice through a provider adapter

QuickBooks Online (initial provider)
  -> owns the accounting customer and receivable
  -> presents the hosted invoice/payment experience
  -> records payment through QuickBooks Payments
  -> reports invoice/payment changes back to CaseDesk

CaseDesk entitlement service
  -> reconciles provider evidence
  -> changes subscription access state
  -> enforces purchased features and limits
```

QuickBooks must never become the source of truth for which CaseDesk features a workspace owns. The provider adapter must permit future Manual, Stripe, Paddle, or other implementations without changing entitlement logic.

Commercial `SubscriptionInvoice` records must remain separate from [[CaseInvoice]]. A case invoice is money an immigration practice charges its client; a subscription invoice is money CaseDesk charges the practice.

## Database Foundation

- Implemented catalog: `CommercialModule`, `CommercialFeature`, `CommercialLimit`, `SubscriptionPlan`, `SubscriptionPlanPrice`, `PlanFeature`, `PlanLimit`.
- Implemented workspace agreements: `WorkspaceSubscription`, `WorkspaceFeatureOverride`, `WorkspaceLimitOverride`, `WorkspaceEntitlementSnapshot`.
- Planned add-ons: `CommercialAddon`, `AddonFeature`, `AddonLimit`, `WorkspaceAddon`.
- Planned promotions: `Promotion`, `PromotionPlanEligibility`, `PromotionFeature`, `PromotionLimit`, `WorkspacePromotion`; trial dates and conversion state already live on `WorkspaceSubscription`.
- Planned usage: `UsageMetric`, immutable `UsageRecord`, and period-level `UsageBucket` aggregates.
- Planned commercial billing: `BillingProviderCustomer`, `SubscriptionInvoice`, and provider event/reconciliation records.
- Planned partnerships: `Partner` and `PartnerReferral`. Immutable commercial changes are already captured by `SubscriptionAuditLog`.

Plans are editable bundles, never runtime identities. Application code checks feature keys such as `calling`, `sms`, `quickbooks`, or `nova_ai`; it must never branch on names such as Solo or Firm. Plan prices are rows keyed by currency and interval. A custom plan uses the same structure but is private to one workspace.

Exactly one plan may be marked **Default for new workspaces**. Platform Admin controls this rule; public agency registration assigns that active plan atomically and refuses to create a commercially unconfigured tenant. Demo is seeded as the initial default with a seven-day trial and the Solo/basic feature and limit bundle.

## Entitlement Resolution

One central service resolves effective access in this deterministic order:

```text
subscription access state
  -> base plan grants and limits
  -> active add-ons
  -> active promotions
  -> active workspace overrides
  -> effective entitlement snapshot
```

Add-ons and promotions can enable features or add to limits. Workspace overrides are final and can enable, disable, replace, start, or expire. An unlimited limit is explicit and is not represented by an arbitrary large number. The result records the source/reason of each value for support and upgrade messaging.

Proposed service surface:

```js
hasFeature(agencyId, featureKey)
getLimit(agencyId, limitKey)
getWorkspaceEntitlements(agencyId)
canConsume(agencyId, metricKey, amount)
consumeUsage(agencyId, metricKey, amount, context)
getSubscriptionAccessMode(agencyId)
```

`backend/src/services/entitlementService.js` resolves live entitlements and persists a versioned snapshot after Platform Owner changes. In-process or distributed caching may be added only with cross-instance invalidation and expiry-aware recomputation. Usage consumption must atomically check and increment the relevant period bucket; a separate check-then-write flow is unsafe.

## Access and Security

A permitted operation requires both commercial and user authorization:

```text
authenticated identity
  -> trusted Agency membership
  -> subscription access mode
  -> workspace feature entitlement
  -> existing role/portal capability
  -> existing tenant/assignment/resource predicate
```

Reusable backend controls should include `requireActiveSubscription`, `requireFeature`, and `requireLimit`. They derive the workspace only from `req.auth.agencyId`. Frontend hooks and `FeatureGate` components provide locked/upgrade states but are not security boundaries.

Provider callbacks and reconciliation workers must remain available when a subscription is past due, suspended, cancelled, or read-only. Otherwise CaseDesk could miss the payment that should restore access.

Subscription outcomes use distinct errors: feature not included, subscription inactive/read-only, usage limit exceeded, seat limit exceeded, and user permission denied.

## Subscription State

- `trialing` and `active`: purchased entitlements are available.
- A `trialing` subscription receives the selected plan's configured trial duration. The public Demo plan grants the basic Solo feature bundle for seven days; an expired or undated trial resolves to read-only access.
- `past_due`: warning state; policy determines continued access.
- `grace_period`: time-limited access until `graceEndsAt`.
- `suspended`, `cancelled`, and `read_only`: retain data and allow the configured read/export surface; block business writes.

Subscription state should drive or reconcile with [[Agency]].`accessStatus`, but there must be one documented owner of the transition to avoid conflicting status updates.

## QuickBooks Billing Flow

CaseDesk—not a static QuickBooks recurring template—should generate each billing-period invoice so current add-ons, seats, promotions, and metered overages are priced correctly.

```text
billing scheduler claims subscription period
  -> pricing engine creates immutable charge snapshot
  -> QuickBooks adapter resolves/creates CaseDesk's customer
  -> adapter creates and sends QuickBooks invoice
  -> hosted payment is completed through QuickBooks Payments
  -> signed webhook is durably stored and acknowledged
  -> asynchronous reconciliation verifies live invoice/payment state
  -> local SubscriptionInvoice is marked paid idempotently
  -> subscription becomes active or clears past-due state
```

The scheduler needs an idempotency identity for `(subscriptionId, periodStart, periodEnd)` and database leasing so retries or multiple API instances cannot create duplicate receivables. Invoice lines, tax, currency, discounts, seat counts, usage quantities, and calculated rates are frozen on the local invoice before the provider call.

QuickBooks recurring invoices/autopay may be offered later for fixed agreements, but they are not the primary scheduler because changing totals can affect autopay and cannot reliably express dynamic seat and usage charges. QuickBooks Payments availability, supported methods, hosted links, account eligibility, and provider limits must be treated as provider capabilities rather than assumed globally.

Payment webhooks are signals, not unquestioned truth. Reconciliation must validate the QuickBooks realm, customer, invoice ID, amount, currency, balance, and provider status. Duplicate and out-of-order events must be harmless. Unpaid invoices progress through `past_due`, `grace_period`, and then the configured read-only policy; customer data is never deleted as a payment consequence.

## Seats and Usage

Paid staff seats are counted from active [[AgencyMember]] records using configurable billable role categories. Client portal and developer identities are excluded by default. Invitations, reactivation, and applicable role transitions must reserve/check a seat transactionally.

Usage meters initially cover Nova AI, Twilio Voice, SMS, and storage. Provider cost and customer retail rate are independently configurable and snapshotted on usage/invoice records. Customer APIs never expose provider cost.

## Administration and Customer UI

The existing developer portal is now named Platform Admin. Its sections are route-addressable so commercial operations can be linked and refreshed independently. `/developer/subscriptions` manages the reusable plan catalog, prices, feature grants, and limits; `/developer/workspaces` manages each agency's plan/status/provider assignment and dated per-feature overrides. Plan edits replace the complete price, feature, and limit configuration in one transaction, retain stable plan keys, write a platform-level commercial audit snapshot, and invalidate entitlement snapshots for every workspace assigned to that plan. `Legacy Full Access` is protected from editing. Later phases add add-ons, usage, invoices, promotions, trials, partner revenue, and full commercial audit presentation.

The CaseDesk showcase website can render the active public catalog from `GET /api/public/commercial/plans`. This endpoint is a deliberately reduced public projection: it exposes plan presentation data, active prices, and included features/limits grouped by module, while excluding all customer/workspace, audit, override, internal-plan, legacy-plan, and database-identity data. Responses allow cross-origin GET requests, are rate-limited, and use short browser/CDN caching so catalog edits propagate without querying the commercial control surface directly.

Workspace Settings should add **Subscription & Billing** for workspace administrators, showing current plan, cycle, renewal, seats, enabled modules, add-ons, customer-visible usage, invoices, payment method state, and available subscription actions. Commercially important unavailable features should remain discoverable as locked navigation with specific upgrade messaging.

## Existing Workspace Migration

Migration `20260911120000_add_commercial_entitlements` seeds the catalog and assigns every existing customer workspace an active `Legacy Full Access` subscription with all current capabilities and unlimited limits. New onboarding must explicitly assign a trial or purchased plan in a later phase. Resolution remains in observation/control mode until every workspace is verified; backend gates will then be enabled incrementally for Calling, SMS, QuickBooks, Nova AI, Incentives, Revenue Contests, Public Booking, and Workflow Automation.

## Architectural Finding

Blocking before subscription-state enforcement: `requireAuth` currently exposes `req.auth.readOnly`, but no shared write middleware was found enforcing it across protected mutation routes, and `productionSecurity.js` contains no such guard. That enforcement boundary must be implemented and tested before commercial suspension relies on `Agency.accessStatus = read_only`.

## Initial Testing Boundary

Cover plan upgrade/downgrade, add-on start/end, promotion and override expiry, trial conversion/expiry, QuickBooks invoice creation idempotency, duplicate/out-of-order webhooks, payment reactivation, past-due grace transitions, read-only writes, seat races, usage races, frontend locked states, role plus entitlement interaction, legacy migration, and cross-tenant isolation.
