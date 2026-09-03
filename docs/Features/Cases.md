---
type: feature
status: active
risk: critical
---

# Cases

## Purpose
Represents an agency's immigration matter for one [[Client]], including type, stage, status, priority, owner/team, lifecycle, applicants, profile data, and all case workspaces.

## Depends On
- [[Clients]]
- [[Authentication]]
- [[Authorization]]
- [[Multi-Tenancy]]

## Used By
[[Case Information]], [[Documents]], [[Forms and Questionnaires]], [[Workflows and Tasks]], [[Appointments and Booking]], [[Communications]], [[Billing and Payments]], [[Incentives and Workload]], and [[Client Portal]].

## Database Models
[[Case]], `CaseAssignment`, `CaseRoleAssignment`, `CaseStageHistory`, `ImmigrationProfile`, `ImmigrationProfileCaseAccess`, `CaseAssessment`, `CaseCollaborationRequest`, and [[ActivityLog]].

## Backend
`backend/src/routes/caseRoutes.js`; case, lifecycle, team, applicant, assessment, collaboration, role-assignment, information, timeline, invoice, and workflow controllers under `backend/src/controllers/`; `backend/src/services/caseRoleService.js`, `caseRequiredTeamService.js`, `caseCollaborationService.js`, and `caseTypeOptionsService.js`.

## Frontend
`frontend/src/pages/Cases.jsx`, `frontend/src/pages/CaseProfile.jsx`, `frontend/src/components/cases/`, and `frontend/src/components/case-profile/`.

## Integrations
Indirectly [[QuickBooks Online]], [[Supabase]], [[Microsoft 365]], [[Twilio]], and [[Zoom]].

## Business Rules
Cases are soft-deleted with `deletedAt`, can be archived, and record stage history. Primary ownership and active assignments govern access and incentives. Required-team rules gate case operations; lifecycle transitions can require billing review.

## Permissions
Case reads use `caseAccessWhere`; case-linked child resources must use case-linked predicates. Staff roles and per-user case page/tab access are both enforced.

## Side Effects
Lifecycle, assignments, stage changes, billing, notifications, activity, and incentive calculations can change together.

## Change Risk
Critical because most operational features are case children.

## Tests
`backend/test/caseProfileEdit.test.js`, `caseProfileRecovery.test.js`, `caseCreationRequiredTeamUi.test.js`, `caseRequiredTeamEligibility.test.js`, `caseRoles.test.js`, `nestedCaseAuthorization.test.js`, and `caseClosureBillingReview.test.js`.
