---
type: system
status: active
risk: critical
---

# Multi-Tenancy

## Tenant Boundary

The tenant is [[Agency]]. Most domain tables carry `agencyId`, and Prisma defines agency relations/indexes. Authentication derives the active tenant from the authenticated user's first active [[AgencyMember]]; clients cannot choose `agencyId` in request data.

Protected controllers and services are expected to include `agencyId: req.auth.agencyId` in every read and write. Assigned-data boundaries are layered through `backend/src/middleware/authorization.js`. Public endpoints resolve a tenant from unguessable or verified tokens, provider connections, booking links, or webhook credentials rather than accepting a free tenant identifier.

## Important Exceptions

- Supabase Auth identities are global and mapped by [[User]].`authUserId`.
- [[OnboardingRequest]] begins before a normal active membership exists.
- Public [[Appointments and Booking]], lead intake, retainers, and provider webhooks have purpose-specific tokens/signatures and rate limiting.
- [[Client Portal]] users still authenticate through Supabase, then link to a client with [[ClientUser]].
- Provider secrets are encrypted using `backend/src/services/secretEncryption.js` and tenant-specific settings rows.

## Deletion

Many agency foreign keys use `onDelete: Cascade`, so deleting an agency would recursively remove extensive business data. User/assignee relations often use `SetNull` instead to retain records. No operational agency-delete workflow should be introduced without a full schema audit.

## Tests

Authorization suites, `backend/test/clientPipelineBoundary.test.js`, `backend/test/nestedCaseAuthorization.test.js`, `backend/test/frontdeskClientCaseAccess.test.js`, and feature tests that assert `agencyId` predicates.
