---
type: feature
status: active
risk: high
---

# Leads

## Purpose
Runs the prospect pipeline from manual, CSV, public, website, and provider intake through routing, follow-up, consultation, commercial status, duplicate review, and conversion.

## Depends On
- [[Authentication]]
- [[Authorization]]
- [[Multi-Tenancy]]
- [[Appointments and Booking]]

## Used By
[[Clients]], [[Cases]], [[Dashboard and Search]], [[Communications]], and [[Notifications]].

## Database Models
[[Lead]] plus `LeadSource`, `LeadCampaign`, `LeadActivity`, `LeadFollowUp`, `LeadRoutingRule`, `LeadTransferRequest`, `LeadConsultation`, `LeadConversion`, `LeadIncomingEvent`, `LeadSourceConnection`, import, duplicate, qualification, and history models.

## Backend
`backend/src/modules/leads/` contains routes, controllers, repository/services, validation, CSV/provider adapters, reports, routing, retainer logic, and four worker families.

## Frontend
`frontend/src/modules/leads/pages/` and `frontend/src/modules/leads/components/`.

## Integrations
[[Meta Lead Ads]], [[Twilio]], [[SMTP and IMAP]], and [[QuickBooks Online]] indirectly after conversion.

## Business Rules
Lead numbering and source attribution are agency-scoped. Intake is idempotent, normalized, duplicate-aware, assigned by rules/backlog, and may send a welcome message. Conversion can create/link a client and case. Timers monitor first response, stale outreach, overdue work, and reactivation.

## Permissions
Staff require leads or intake page access; data scope can be none, assigned, or all. Routing/transfer and destructive/commercial actions add role checks.

## Side Effects
Creates activities, messages, appointments, follow-ups, notifications, clients/cases, and retainer/billing records.

## Change Risk
High because public ingestion and conversion cross security and CRM boundaries.

## Tests
`backend/test/leadIntake.test.js`, `leadService.test.js`, `leadAuthorization.test.js`, `leadRouting.test.js`, `leadPipelineImplementation.test.js`, `leadRetainer.test.js`, `leadValidation.test.js`, and other `lead*.test.js` suites.
