---
type: feature
status: active
risk: critical
---

# Users and Onboarding

## Purpose
Provisions agencies, staff/client accounts, memberships, invitations, consultant profiles, roles, account status, temporary-password requirements, and per-user portal access.

## Depends On
- [[Supabase]]
- [[Authentication]]
- [[Multi-Tenancy]]

## Used By
Every protected feature, especially [[Authorization]], [[Cases]], [[Leads]], and [[Incentives and Workload]].

## Database Models
[[User]], [[Agency]], [[AgencyMember]], `OnboardingRequest`, and `ConsultantProfile`.

## Backend
`authRoutes.js`, `onboardingRoutes.js`, `userRoutes.js`, `adminRoutes.js`, `consultantRoutes.js`, `accountSettingsRoutes.js`; corresponding controllers; Supabase auth and avatar services.

## Frontend
`frontend/src/auth/`, login/reset/invite/change-password pages, `frontend/src/pages/TeamMembers.jsx`, and staff/account/settings components.

## Integrations
[[Supabase]] Auth/Storage and [[SMTP and IMAP]] for account messages.

## Business Rules
User and membership must both be active; agency onboarding/status/access status are checked on every authenticated request. Staff and workspace invitations use Supabase Auth links. Client-portal onboarding uses a server-signed CaseDesk link that remains valid for seven days, performs only a read on page load, and is consumed by activating the invited account only after the client submits a password. Resending does not invalidate another still-valid client onboarding link; all outstanding links stop working when the account becomes active. Membership role is authoritative. Read-only agencies can authenticate but writes are blocked by endpoint/security logic.

## Permissions
User/team administration is admin-only; developer endpoints require the developer role. Self-service account/profile changes are narrower.

## Side Effects
Creates or updates Supabase identities, memberships, invitation mail, auth cache, and audit/activity data.

## Change Risk
Critical because provisioning determines tenant and privilege boundaries.

## Tests
`backend/test/authProduction.test.js`, `authRecoveryFlow.test.js`, `clientPortalInviteToken.test.js`, `authorization.test.js`, `temporaryPassword.test.js`, `consultantNameSelfService.test.js`, and `developerAccount.test.js`.
