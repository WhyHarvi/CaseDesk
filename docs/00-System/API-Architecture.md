---
type: system
status: active
risk: high
---

# API Architecture

## Shape

The Express API is mounted below `/api` in `backend/src/server.js`. Health endpoints are `/api/health/live` and `/api/health`. Most staff routes apply [[Authentication]], a staff role, then a page/tab/capability gate from [[Authorization]].

## Route Groups

- Identity/admin: `/auth`, `/onboarding`, `/account`, `/admin`, `/consultants`, `/users`, `/developer`, `/settings`.
- CRM: `/leads`, `/clients`, `/cases`, `/follow-ups`, `/search`, `/dashboard`, `/workload`.
- Case work: `/client-documents`, `/document-templates`, `/shared-library`, `/written-documents`, `/case-forms`, `/form-templates`, `/correspondence`, `/workflow-templates`, `/activity-logs`.
- Financial: `/payments`, `/payments-overview`, `/payment-schedules`, `/fee-categories`, `/case-billing-retainer`, `/billing-settings`, `/incentives`, `/incentive-plans`.
- Scheduling/comms: `/appointments`, `/booking`, `/communications`, `/notifications`, `/internal-chat`, `/call-history`, `/twilio-calls`, `/mailboxes`, `/zoom`.
- Portal/public: `/portal`, `/client-portal`, `/public/booking`, `/public/agency`, `/public/lead-intake`, `/public/commercial`, `/client-communication`, `/retainer` routes nested in feature routers, and provider/webhook routes.

The developer-only `/developer/commercial` endpoints expose the subscription catalog, customer workspace subscriptions, resolved entitlements, audited workspace feature overrides, and atomic plan creation/editing. Plan writes use `POST /developer/commercial/plans` and `PUT /developer/commercial/plans/:planId`; their payload is a full replacement of plan metadata, prices, feature grants, and limits and always requires an audit reason. These routes are platform controls and must never be mounted under agency-admin authorization.

`GET /public/commercial/plans` is the read-only showcase contract. It is unauthenticated, cross-origin, cached, and rate-limited. It returns only active plans with `public` visibility and excludes legacy/internal/private plans, database IDs, customer counts, workspace subscriptions, overrides, entitlements, and audit records. The response contains stable plan keys, customer-facing descriptions, active prices, and included features/limits grouped by module.

## Conventions

Requests and responses are JSON except multipart uploads and form-encoded provider callbacks. The frontend uses `frontend/src/services/api.js`. Route/controller errors flow to the centralized error handler. Write responses trigger agency dashboard-cache invalidation after successful completion.

## Public-Surface Controls

Public booking and lead intake use token resolution and rate limiting; Twilio, QuickBooks, Zoom, communication, and lead-provider callbacks perform provider-specific validation. Raw request bodies are retained for webhook signature verification. Any new tenant-specific public route requires explicit tenant resolution, authentication/signature controls, rate limits, idempotency, and safe error behavior. The global public commercial catalog is not tenant-specific and instead uses strict visibility filtering and allowlisted serialization.
