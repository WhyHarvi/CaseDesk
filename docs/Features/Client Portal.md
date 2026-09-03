---
type: feature
status: active
risk: critical
---

# Client Portal

## Purpose
Gives authenticated clients a policy-controlled view of cases, documents, questionnaires/forms/signatures, agreements, appointments, invoices/payments, profile, notifications, help, and chat.

## Depends On
- [[Authentication]]
- [[Authorization]]
- [[Multi-Tenancy]]
- [[Clients]]
- [[Cases]]

## Used By
Client-facing [[Documents]], [[Forms and Questionnaires]], [[Billing and Payments]], [[Appointments and Booking]], and [[Communications]].

## Database Models
[[ClientUser]], [[PortalAccessPolicy]], [[User]], [[Client]], [[Case]], and the exposed feature models.

## Backend
`backend/src/routes/portalRoutes.js`, `clientPortalRoutes.js`, `clientCommunicationRoutes.js`; portal/client-portal controllers; `portalAccessService.js`, `clientPortalPolicyService.js`, `portalAccessService.js`, and `backend/src/middleware/clientPortalPolicy.js`.

## Frontend
Portal routes in `frontend/src/routes/AppRoutes.jsx`, pages under `frontend/src/pages/client-portal/`, `frontend/src/components/client-portal/`, and `frontend/src/api/clientPortalApi.js`.

## Integrations
[[Supabase]] Auth/Realtime/Storage and provider-backed subfeatures.

## Business Rules
A [[ClientUser]] links the app identity to one agency client. Default, client-level, and case-level policies resolve to an effective allow/deny; suspension overrides actions. Resource IDs are resolved to a case before policy checks. A sentinel represents case-less general chat.

## Permissions
Client role, tenant link, record ownership, area policy, and resource policy all apply. Staff portal-management requires the `manageClientPortal` capability.

## Side Effects
Client actions upload/sign documents, submit questionnaires, send chat, change notification preferences, and create portal activity.

## Change Risk
Critical because mistakes expose legal, identity, or financial data to clients.

## Tests
`backend/test/clientPortalPolicy.test.js`, `portalAccess.test.js`, `clientFormSignatureNotice.test.js`, and `consultantP4PortalCollaboration.test.js`.
