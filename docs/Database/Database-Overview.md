---
type: database
status: active
risk: critical
---

# Database Overview

`backend/prisma/schema.prisma` defines 165 PostgreSQL models. Prisma is initialized by `backend/src/services/prisma/client.js`, with `DATABASE_URL` and optional connection-limit handling; `DIRECT_URL` is used by Prisma tooling/migrations.

## Ownership Pattern

[[Agency]] is the tenant root. Nearly all business rows carry `agencyId` and cascade when their agency is deleted. [[User]] is linked to Supabase by `authUserId`; [[AgencyMember]] supplies the active tenant role and permissions. [[Client]] owns [[Case]] records, while assignment tables and [[ClientUser]] add staff/client access paths.

## Core CRM and Access

[[Agency]], [[User]], [[AgencyMember]], [[OnboardingRequest]], [[ClientUser]], [[PortalAccessPolicy]], `ConsultantProfile`, `CaseAssignment`, `CaseCollaborationRequest`, `CaseRoleAssignment`, `TeamIncentiveRoleAssignment`, [[Client]], [[Case]], `CaseStageHistory`, `ImmigrationProfile`, and `ImmigrationProfileCaseAccess`.

## Scheduling

[[Appointment]], `AppointmentEvent`, `AppointmentCalendarSync`, `AppointmentAdvice`, `BookingSettings`, `BookingSessionType`, `SchedulingStaffPreference`, `BookingSessionTypeStaff`, `BookingMessageDelivery`, `SchedulingBlock`, `BookingWaitlistEntry`, `BookingSlotHold`, `BookingPaymentHold`, `BookingVerificationCode`, `AppointmentMeetingJob`, `AgencyZoomConnection`, and `ZoomHostMapping`.

## Billing and Incentives

[[CaseInvoice]], [[Payment]], [[CasePaymentSchedule]], `CaseInvoiceLine`, `AgencyCustomPaymentLedger`, `CashTransaction`, `CashAllocation`, `CashReconciliation`, `InvoiceRefund`, `PaymentApproval`, `CaseManualLedgerEntry`, `CasePaymentInstallment`, schedule templates, billing/payment settings, fee categories, QuickBooks settings/events, account statements, invoice credit/snapshot records, incentive plans/tiers/role shares/timeline legs/evaluations, and `IncentiveLedgerEntry`.

## Communications and Calls

[[CommunicationConversation]], `CommunicationMessage`, reactions, attachments, outbox, delivery events, permissions, consent, templates, preferences, automation/SLA/retention/client-access policies, audit/unmatched items, mail connection/settings models, Twilio settings/lines/assignees, `CallSession`, `CallRingDispatch`, and `CallEvent`.

## Case Work Product

[[ClientDocument]], [[CaseForm]], `DocumentTemplate`, `DocumentFolder`, `SharedLibraryDocument`, all case/agency form version, field, permission, request, signature, comment, and audit models, `QuestionnaireAssignment`, information profiles/section states, written documents/versions, correspondence templates/versions, `Note`, `FollowUp`, workflow templates/steps, `CaseWorkflowStep`, and `CaseAssessment`.

## Leads, Notifications, Import, Operations

[[Lead]] plus all lead source, campaign, activity, message, history, routing, follow-up, consultation, conversion, qualification, intake/provider/import/duplicate models; [[Notification]], preferences/deliveries/push subscriptions; Case Easy contact/case/report rows; automated/expiry policies and deliveries; internal chat models; [[ActivityLog]], `UserPortalActivity`, `SupportTicket`, `DeveloperSetting`, `ApiRateLimitBucket`, and [[WorkerLease]].

## Deletion and Consistency

- Tenant deletion cascades broadly and is inherently destructive.
- Core parent deletion often cascades into case/client work; actor/assignee foreign keys commonly use `SetNull` or `Restrict` to retain history.
- Soft deletion/archive fields exist on selected domain records and must be included in queries deliberately.
- Agency-scoped unique keys, provider IDs, tokens, and idempotency keys are core duplicate-prevention controls.
- Financial `Decimal` fields must not be converted through imprecise floating-point arithmetic.

## Schema Change Risk

Critical. Migrations must consider cascade depth, existing worker queries, compound uniqueness, tenant indexes, provider reconciliation, and frontend response expectations.
