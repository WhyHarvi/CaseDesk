---
type: database-model
status: active
risk: critical
---

# AgencyMember

## Purpose
Connects a [[User]] to an [[Agency]] with the active role and per-user permissions used for every authenticated request.

## Important Fields
`agencyId`, `userId`, `role`, `isActive`, JSON `permissions`, and `mustChangePassword`; unique on agency/user.

## Relationships
Belongs to one agency and one user, both with cascade deletion.

## Features and Services
[[Authentication]], [[Authorization]], [[Multi-Tenancy]], [[Users and Onboarding]], and portal-access settings. Loaded/cached by `backend/src/middleware/authMiddleware.js` and normalized by `portalAccessService.js`.

## Deletion and Rules
The first active membership currently selects the request tenant. Role and permissions here override similarly named legacy user fields for request authorization.
