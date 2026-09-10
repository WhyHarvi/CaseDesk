---
type: system
status: active
risk: critical
---

# Authentication

## Purpose

CaseDesk delegates credential and session handling to [[Supabase]] Auth. The frontend stores the Supabase session through `frontend/src/services/supabase.js` and `frontend/src/auth/AuthContext.jsx`; `frontend/src/services/api.js` sends its access token as a Bearer token.

## Backend Flow

`backend/src/middleware/authMiddleware.js` extracts the Bearer token. `backend/src/services/supabaseAuth.js` verifies the JWT locally against the configured project's JWKS, fixed supported algorithms, issuer, audience, role, timestamps, and subject. It then loads the matching [[User]] and first active [[AgencyMember]], validates user and [[Agency]] states, and places trusted `userId`, `agencyId`, `role`, and permissions on `req.auth`.

Invitations use `backend/src/middleware/invitationAuth.js`; workspace setup uses `backend/src/middleware/onboardingAuth.js`. Recovery, invite, temporary-password, and account operations live in `backend/src/routes/authRoutes.js`, `backend/src/controllers/authController.js`, and `backend/src/routes/onboardingRoutes.js`.

Client-portal onboarding is intentionally separate from staff/workspace invitation redemption. The backend signs a seven-day token bound to the CaseDesk user and Supabase Auth identity. The browser fragment keeps that bearer token out of the initial page request; loading the page is read-only, and an explicit password submission performs the one-time activation. The account's transition from `invited` to `active` invalidates every outstanding onboarding link for that client.

## Configuration

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and optional dedicated `PORTAL_INVITE_SIGNING_KEY`; frontend: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Signing and service-role keys are backend-only.

## Depends On

[[Supabase]], [[User]], [[AgencyMember]], [[Agency]], [[Multi-Tenancy]].

## Tests

`backend/test/authProduction.test.js`, `backend/test/localAuthVerification.test.js`, `backend/test/authRecoveryFlow.test.js`, `backend/test/temporaryPassword.test.js`, and `backend/test/developerAccount.test.js`.
