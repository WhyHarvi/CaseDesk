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
Client numbers are agency-scoped. A client may have a primary phone and an optional secondary phone; both are normalized, must differ, and participate in agency-scoped duplicate detection against either phone slot and active leads. Either number can identify a client in search, appointment linking, inbound communications, call history, and Case Easy matching. The primary phone remains the default destination for automated/outbound SMS and WhatsApp unless a user explicitly calls the secondary number. Structured names, both mapped phone fields, and UCI can feed immigration forms. Archive and access scope affect visibility; client creation can trigger activity and QuickBooks sync.

## Permissions
Staff route access requires the clients page. Record reads use `clientAccessWhere`; existing-client mutations remain role-controlled. Portal access uses [[ClientUser]].

## Side Effects
Creates activity, may synchronize a QuickBooks customer (primary phone to `PrimaryPhone`, secondary phone to `AlternatePhone`), and can seed/synchronize profile information.

## Change Risk
High because clients anchor cases, billing, communications, documents, appointments, leads, and portal identities.

## Tests
`backend/test/clientManagementCompletion.test.js`, `backend/test/clientPipelineBoundary.test.js`, `backend/test/clientStructuredName.test.js`, `backend/test/clientSecondaryPhone.test.js`, `backend/test/clientDateOfBirthValidation.test.js`, and `backend/test/clientCreationActivity.test.js`.
