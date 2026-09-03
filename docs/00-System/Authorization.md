---
type: system
status: active
risk: critical
---

# Authorization

## Layers

1. `backend/src/middleware/authMiddleware.js` establishes a trusted authenticated membership.
2. `requireRole` in `backend/src/middleware/authorization.js` gates developer, admin, consultant, frontdesk, and client roles.
3. `backend/src/services/portalAccessService.js` gates staff pages, case tabs, capabilities, and `none`/`assigned`/`all` data scope from [[AgencyMember]].`permissions`.
4. `clientAccessWhere`, `caseAccessWhere`, and related-record helpers add assignment/client ownership constraints.
5. Route and controller-specific checks protect mutations; [[Client Portal]] additionally uses `backend/src/middleware/clientPortalPolicy.js` and [[PortalAccessPolicy]].
6. `backend/src/middleware/productionSecurity.js` and controller checks enforce read-only agency mode for writes.

Frontend guards in `frontend/src/auth/AuthRoutes.jsx` and `frontend/src/auth/portalAccess.js` improve navigation but are not a security boundary.

## Role Shape

Admins receive all portal access. Consultants default to assigned clients/cases/leads plus broad case tabs; frontdesk defaults to workspace-wide viewing of clients/cases/leads but mutation endpoints remain separately role-gated. Client identities are linked by [[ClientUser]] and limited to portal routes and policy decisions.

## Tests

`backend/test/authorization.test.js`, `backend/test/nestedCaseAuthorization.test.js`, `backend/test/consultantP0Authorization.test.js` through `consultantP4PortalCollaboration.test.js`, `backend/test/frontdeskClientCaseAccess.test.js`, `backend/test/leadAuthorization.test.js`, and `backend/test/clientPortalPolicy.test.js`.

## Change Risk

Critical: a missing agency, assignment, role, or policy predicate can expose another tenant's or another consultant's data.
