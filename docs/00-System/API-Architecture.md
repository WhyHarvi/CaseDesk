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
- Portal/public: `/portal`, `/client-portal`, `/public/booking`, `/public/agency`, `/public/lead-intake`, `/client-communication`, `/retainer` routes nested in feature routers, and provider/webhook routes.

## Conventions

Requests and responses are JSON except multipart uploads and form-encoded provider callbacks. The frontend uses `frontend/src/services/api.js`. Route/controller errors flow to the centralized error handler. Write responses trigger agency dashboard-cache invalidation after successful completion.

## Public-Surface Controls

Public booking and lead intake use token resolution and rate limiting; Twilio, QuickBooks, Zoom, communication, and lead-provider callbacks perform provider-specific validation. Raw request bodies are retained for webhook signature verification. Any new public route requires explicit tenant resolution, authentication/signature controls, rate limits, idempotency, and safe error behavior.
