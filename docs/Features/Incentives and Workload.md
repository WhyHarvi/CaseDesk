---
type: feature
status: active
risk: high
---

# Incentives and Workload

## Purpose
Calculates consultant workload/health, collaboration requests, case roles, and configurable incentive plans, tiers, role shares, timeline legs, evaluations, and ledger credits.

## Incentive Expansion
See [[Incentive Expansion Requirements]] for the active Study Permit work milestones, reapplication cycles, explicit periods, eligible net-revenue contest, private simulator, refund treatment, and calculation snapshots.

## Depends On
- [[Cases]]
- [[Workflows and Tasks]]
- [[Billing and Payments]]
- [[Users and Onboarding]]

## Used By
Staff incentives, team management, case timelines, and notifications.

## Database Models
`IncentivePlan`, `IncentivePlanTier`, `IncentivePlanRoleShare`, `IncentivePlanMilestoneRule`, `IncentivePlanTimelineLeg`, `IncentivePlanTimelineLegTier`, `IncentiveLedgerEntry`, `IncentiveTimelineLegEvaluation`, `IncentiveMilestoneEvaluation`, `IncentiveCycle`, `IncentivePeriod`, `IncentiveRevenueCredit`, `IncentiveContest`, `CaseRoleAssignment`, `TeamIncentiveRoleAssignment`, and `CaseCollaborationRequest`.

## Backend
Incentive/plan/case-role routes and controllers; `backend/src/modules/workload/`; services named `incentive*`, `caseRoleService.js`, `caseCollaborationService.js`, and `caseRequiredTeamService.js`.

## Frontend
`frontend/src/pages/Incentives.jsx`, `Workload.jsx`, `frontend/src/components/incentives/`, `frontend/src/components/workload/`, case role/permission overlays, and incentive API clients.

## Integrations
None directly; financial events may originate in [[QuickBooks Online]].

## Business Rules
Credits depend on plans, role shares, assignments, case stage/timeline checkpoints, and eligible financial/activity events. Study Permit milestones credit once per incentive cycle. Revenue contests use net collected fee categories explicitly marked eligible and preserve revenue-owner snapshots. Idempotent ledger/evaluation identities protect against duplicate credit. Archived cases and their case-linked tasks, documents, follow-ups, appointments, and deadline totals are excluded from current workload; case-less, client-level, and lead work remain eligible. Historical productivity metrics remain historical. Workload zero-activity monitoring generates alerts.

## Permissions
Incentives page is individually gated; plan management is admin-only. Workload and collaboration use role/team and case-assignment checks.

## Side Effects
Creates immutable-style ledger/evaluation records, notifications, and collaboration state.

## Change Risk
High because compensation, team access, case assignment, and billing events meet here.

## Tests
All `backend/test/incentive*.test.js`, `workload*.test.js`, `caseRoles.test.js`, and `consultantP4PortalCollaboration.test.js`.
