---
type: product-requirements
status: active
risk: critical
---

# Incentive Expansion Requirements

## Purpose

Extend the existing payment incentive ledger with auditable Study Permit work milestones, explicit incentive cycles and periods, and a separate monthly net-revenue contest.

## Depends On

- [[Incentives and Workload]]
- [[Cases]]
- [[Billing and Payments]]
- [[Follow-Ups and Reminders]]
- [[Authorization]]
- [[Multi-Tenancy]]

## Approved Business Rules

### Study Permit work milestones

A Study Permit incentive plan may configure a flat pool for each of three events. Existing role-share rules split that pool among the snapshotted recipients.

| Event | Authoritative application event |
| --- | --- |
| College Application Submitted | Case enters `Offer Letter Application Submitted` |
| Study Permit Application Submitted | Case enters `Submitted` |
| Post-Submission Follow-Up Completed | Dedicated `Post-submission follow-up` changes to `Completed` |

Each event is credited at most once per `IncentiveCycle`. Reopening and recompleting a follow-up does not duplicate a credit. A reapplication creates a new cycle only through an admin action with an explicit eligibility choice and reason.

### Refunds

- Eligible collected-revenue credits are reversed proportionally for partial refunds and for the remaining amount on a full refund.
- A revenue reversal cannot exceed the original revenue credit.
- Refund attribution keeps the original period and revenue-owner snapshot.
- Work and milestone incentive credits are not automatically reversed by ordinary payment refunds.
- College, government, and disbursement fee refunds do not automatically invalidate work milestones; any exception requires an explicit future admin adjustment flow.

### Eligible revenue and ownership

The monthly contest ranks `net collected eligible revenue`, not incentive earnings. `AgencyFeeCategory.countsTowardRevenue` is the authority. Professional fees default to eligible; college fees, government fees, disbursements, and other categories default to excluded.

Revenue is snapshotted to the case's explicit `revenueOwnerId`, falling back to the primary consultant for existing cases. A later assignment change does not rewrite historical revenue credit ownership.

### Periods and contest

- Incentive periods are explicit records with immutable start/end bounds.
- An admin may close a period early only with a reason. Closing never deletes history and immediately starts the next period.
- Ranking tie-breakers are net revenue, paid-case count, and earliest time the final revenue was reached.
- If those still tie, the users are joint winners and split the prize to the cent.
- A prize may be flat or a percentage of the winner's own net revenue.
- A contest can be finalized only after its period closes. Finalization snapshots the ranking and creates separate contest-prize ledger entries.

## Calculation and history

Posted rows preserve plan name/version, formula type, role/share, source amount, calculated amount, trigger, period, cycle, and a JSON calculation snapshot. Corrections append linked reversal or adjustment rows; posted history is never edited in place.

The breakdown API is tenant-scoped. Administrators may inspect any user in their workspace; non-admin staff are forced to their own user ID.

## Private simulation

The admin-only simulator calculates a candidate plan against tenant-scoped cases and returns per-case, per-event, per-recipient explanations. It is read-only: it creates no ledger/evaluation rows, sends no notification, and never appears in consultant totals.

## Financial and access invariants

- Every query and write is scoped by `agencyId`.
- Plan changes, simulations, reapplication decisions, early closes, and contest finalization are admin-only.
- Qualifying event identities are unique and cycle-aware.
- Posted earnings and contest results are append-only snapshots.
- QuickBooks invoice/payment semantics remain unchanged; revenue competition records are downstream projections of completed collection/refund movements.

## Implementation map

- Schema and migration: `backend/prisma/schema.prisma`, `backend/prisma/migrations/20260903120000_add_incentive_expansion/`
- Core rules: `backend/src/services/incentiveExpansionService.js`
- Posting integration: `backend/src/services/incentiveCreditingService.js`
- Milestone hooks: case, lifecycle, and follow-up controllers
- APIs: incentive expansion controller and incentive routes
- UI: Incentives page and incentive-plan settings panel
- Tests: `backend/test/incentiveExpansion.test.js` plus existing incentive suites

## Known follow-up

The current simulator projects configured milestone rules for matching cases. A historical event-occurrence replay can be added later if the business wants simulations restricted to milestones actually reached inside the selected date window.
