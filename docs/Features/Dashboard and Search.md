---
type: feature
status: active
risk: medium
---

# Dashboard and Search

## Purpose
Aggregates operational KPIs, appointments, work lists, scheduling summaries, and cross-domain search results for staff navigation.

## Depends On
- [[Clients]]
- [[Cases]]
- [[Leads]]
- [[Appointments and Booking]]
- [[Authorization]]

## Used By
The staff landing page and global application header.

## Database Models
Reads many feature models; no dedicated dashboard model. Search spans tenant-scoped CRM/case records.

## Backend
`backend/src/routes/dashboardRoutes.js`, `globalSearchRoutes.js`, their controllers, and `backend/src/services/dashboardCache.js` plus Case Easy search service.

## Frontend
`frontend/src/pages/Dashboard.jsx`, `frontend/src/components/dashboard/`, `frontend/src/components/search/GlobalSearch.jsx`, and layout/header components.

## Integrations
None directly.

## Business Rules
Successful tenant writes invalidate the agency dashboard cache in `backend/src/server.js`. Search and aggregates must honor role, portal-access, assignment, archive/deletion, and tenant filters.

## Permissions
Dashboard requires its page gate; search requires an authenticated staff role and applies domain visibility rules.

## Side Effects
Dashboard/search are read-oriented; cache invalidation is the main shared side effect.

## Change Risk
Medium, but incorrect predicates could leak cross-assignment or tenant information.

## Tests
`backend/test/dashboardCache.test.js`, `globalSearch.test.js`, `casesKpiQuickFilter.test.js`, and `caseEasySearch.test.js`.
