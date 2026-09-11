---
type: database-model
status: active
risk: critical
---

# Commercial Subscription

## Purpose

Stores the platform-owned product catalog and controls which CaseDesk features and limits apply to each [[Agency]]. It does not replace [[AgencyMember]] permissions and is separate from [[CaseInvoice]] and other agency-to-client financial records.

## Catalog Models

- `CommercialModule` groups customer-facing capabilities.
- `CommercialFeature` defines stable boolean feature keys.
- `CommercialLimit` defines numeric/unlimited resource keys.
- `SubscriptionPlan` is an editable feature/limit bundle.
- `SubscriptionPlan.trialDays` defines the reusable trial duration; zero means the plan cannot be assigned as a trial.
- `SubscriptionPlan.isDefaultForNewWorkspaces` selects the single active plan provisioned during agency registration; a partial unique database index prevents multiple defaults.
- `SubscriptionPlanPrice` stores currency and billing-interval prices.
- `PlanFeature` and `PlanLimit` join plans to their commercial configuration.

## Workspace Models

- `WorkspaceSubscription` connects one agency to its current plan, status, interval, provider, currency, negotiated amount, and billing/trial/grace dates.
- `WorkspaceFeatureOverride` and `WorkspaceLimitOverride` provide reasoned, optionally dated agency-specific changes.
- `WorkspaceEntitlementSnapshot` stores a versioned materialization after commercial mutations.
- `SubscriptionAuditLog` records the platform actor, optional agency, before/after state, reason, and timestamp. Workspace changes require an agency; global catalog changes intentionally use a null agency.

## Rules

`backend/src/services/entitlementService.js` resolves plan values first and active workspace overrides last. Missing features are disabled; unlimited limits are explicit. Subscription access mode is resolved independently from individual feature values.

The initial migration gives every existing customer agency `Legacy Full Access` and excludes the dedicated `casedesk-developer` workspace. Runtime enforcement is intentionally deferred until observation and migration validation are complete.

Workspace writes use an agency-scoped PostgreSQL advisory transaction lock. Catalog writes use a separate platform-wide catalog lock, replace prices/features/limits atomically, invalidate derived snapshots for subscribed workspaces, and create a platform-level commercial audit record. Platform APIs are mounted under the existing developer-only route boundary.

Plan keys are immutable after creation because runtime code and external commercial records may refer to them. `Legacy Full Access` is also immutable during rollout. Plans in use are deactivated rather than deleted so subscriptions and historical pricing decisions remain referentially intact.

## Deletion and Consistency

Catalog rows referenced by subscriptions or overrides use restrictive deletion. Commercial audit rows also restrict agency deletion. Snapshot rows cascade with the agency because they are derived and can be rebuilt.
