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
A [[ClientUser]] links the app identity to one agency client. New client accounts are activated through a signed seven-day onboarding link. Loading that link is non-consuming so email-security scanners cannot invalidate it; submitting the password verifies the signed user/auth-identity binding, active client membership, tenant state, and then activates the account once. Default, client-level, and case-level policies resolve to an effective allow/deny; suspension overrides actions. Resource IDs are resolved to a case before policy checks. A sentinel represents case-less general chat.

The Payments page is mobile-first: balance, invoice amounts, due dates, method choices, upload controls, and primary actions fit a one-column phone viewport with full-width touch targets before expanding at larger breakpoints. For an invoice awaiting a method, clients choose from numbered, full-width payment rows. Credit card and QuickBooks bank transfer continue to the hosted provider flow. Interac e-Transfer, debit, and other offline methods require a reference number or image proof and remain unconfirmed until staff verifies and records the payment. Client-submitted evidence cannot update an invoice balance. A fully unpaid invoice keeps a prominent `Change payment method` action; the client may reopen the choices or keep the current method. The chooser shows the fixed base invoice amount and calculates every row from that base, making clear that changing methods replaces the prior processing fee instead of adding another one. The action disappears once any payment activity exists.

## Permissions
Client role, tenant link, record ownership, area policy, and resource policy all apply. Staff portal-management requires the `manageClientPortal` capability.

## Side Effects
Client actions upload/sign documents, submit questionnaires, send chat, change notification preferences, and create portal activity.

## Change Risk
Critical because mistakes expose legal, identity, or financial data to clients.

## Tests
`backend/test/clientPortalPolicy.test.js`, `portalAccess.test.js`, `clientFormSignatureNotice.test.js`, and `consultantP4PortalCollaboration.test.js`.
