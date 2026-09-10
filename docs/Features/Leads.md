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
`frontend/src/modules/leads/pages/` and `frontend/src/modules/leads/components/`. The lead detail curtain exposes adjacent Twilio Call and WhatsApp actions; WhatsApp opens the lead's normalized international number in a new browser tab and does not create an internal communication record. In the Contact card, the phone value opens the guarded CaseDesk dialer and the email value opens Chats in Email mode with the lead pre-addressed. The Overview and Work tabs derive consultation labels from both the saved state and scheduled time, distinguishing Upcoming, In progress, Awaiting outcome, and terminal results; outcome recording is unavailable before the consultation starts.

## Integrations
[[Meta Lead Ads]], [[Twilio]], [[SMTP and IMAP]], and [[QuickBooks Online]] indirectly after conversion.

## Business Rules
Lead numbering and source attribution are agency-scoped. Intake is idempotent, normalized, duplicate-aware, assigned by rules/backlog, and may send a welcome message. An appointment-linked client and its same-client case form the lead's soft profile before formal conversion; contact text alone is never used to infer that link. Posted case payments project the initial-payment status, and once both the retainer and payment are ready the linked records are reused for automatic conversion. Financial reconciliation also repairs historical missing soft links and retries conversion when payment arrived before the signed retainer was recorded. A consultation cannot be completed or marked as a no-show before its scheduled start; cancellation and rescheduling remain available for future bookings. Timers monitor first response, stale outreach, overdue work, and reactivation. When a nurture period expires, the worker atomically reopens the lead, completes its reactivation reminder, and assigns the lead owner a new follow-up due in 24 hours so every open lead retains a valid next action.

## Permissions
Staff require leads or intake page access; data scope can be none, assigned, or all. Routing/transfer and destructive/commercial actions add role checks.

## Side Effects
Creates activities, messages, appointments, follow-ups, notifications, clients/cases, and retainer/billing records. A staff-initiated lead email creates an idempotent `LeadMessageDelivery`, sends through the staff member's connected mailbox, and records the successful contact in lead history.

## Change Risk
High because public ingestion and conversion cross security and CRM boundaries.

## Tests
`backend/test/leadIntake.test.js`, `leadService.test.js`, `leadAuthorization.test.js`, `leadRouting.test.js`, `leadPipelineImplementation.test.js`, `leadRetainer.test.js`, `leadValidation.test.js`, and other `lead*.test.js` suites.
