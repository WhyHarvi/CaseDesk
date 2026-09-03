---
type: feature
status: active
risk: high
---

# Clients

## Purpose
Maintains agency contacts, structured identity/contact data, ownership, archival status, duplicate detection, QuickBooks linkage, portal users, and the parent relationship for cases and client-level records.

## Depends On
- [[Authentication]]
- [[Authorization]]
- [[Multi-Tenancy]]
- [[User]]

## Used By
[[Cases]], [[Leads]], [[Billing and Payments]], [[Communications]], [[Appointments and Booking]], [[Client Portal]], [[Documents]], and [[Forms and Questionnaires]].

## Database Models
[[Client]], [[ClientUser]], `ClientInformationProfile`, and [[ActivityLog]].

## Backend
Routes/controller/services: `backend/src/routes/clientRoutes.js`, `backend/src/controllers/clientController.js`, `backend/src/services/clientNumberService.js`, `backend/src/services/contactDuplicateService.js`, `backend/src/services/clientProfileSyncService.js`, and `backend/src/services/clientQuickBooksSyncService.js`.

## Frontend
`frontend/src/pages/Clients.jsx`, `frontend/src/pages/ClientProfile.jsx`, `frontend/src/components/clients/`, and shared client comboboxes.

## Integrations
[[QuickBooks Online]], [[Twilio]], and [[Supabase]].

## Business Rules
Client numbers are agency-scoped. Normalized email and phone are unique per agency. Archive and access scope affect visibility. Structured names and UCI feed immigration forms; client creation can trigger activity and QuickBooks sync.

## Permissions
Staff route access requires the clients page. Record reads use `clientAccessWhere`; existing-client mutations remain role-controlled. Portal access uses [[ClientUser]].

## Side Effects
Creates activity, may synchronize a QuickBooks customer, and can seed/synchronize profile information.

## Change Risk
High because clients anchor cases, billing, communications, documents, appointments, leads, and portal identities.

## Tests
`backend/test/clientManagementCompletion.test.js`, `backend/test/clientPipelineBoundary.test.js`, `backend/test/clientStructuredName.test.js`, `backend/test/clientDateOfBirthValidation.test.js`, and `backend/test/clientCreationActivity.test.js`.
