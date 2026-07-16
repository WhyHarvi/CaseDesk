# Lead MVP gap analysis and ordered implementation plan

**Audit date:** 2026-07-14  
**Scope:** The first production lead lifecycle: intake -> assignment -> contact -> follow-up -> conversion or loss -> reporting.

## Executive assessment

CaseDesk already has a strong lead-management foundation, but it does **not yet support the complete launch lifecycle from the UI/API**.

The strongest completed areas are:

- tenant-aware lead, activity, assignment, follow-up, loss, conversion, qualification, consultation, intake, import, and duplicate-candidate tables;
- authenticated manual/Quick Add intake, public forms, CSV import, and signed/idempotent provider webhooks;
- background intake processing, phone/email normalization, lead-to-lead duplicate detection for incoming events, and duplicate-review queuing;
- lead dashboard, detailed reports, lead detail display, qualification, consultation, commercial-readiness, and conversion-to-client/case foundations;
- agency scoping in backend queries, tenant-isolation tests, RLS migrations, and append-only update protection for the three main history tables.

The first production release is blocked by these gaps:

1. `manager` and `staff` exist in the schema but are rejected by authentication. Lead routes only support `admin` and `consultant`.
2. Manual/Quick Add creation does not perform duplicate checks. Incoming-event duplicate checks only search leads, not clients.
3. Duplicate-review candidates can be listed but cannot be resolved, linked, merged, or used to update an existing record.
4. There are no operational endpoints or UI actions for recording a contact attempt/connection/message/email/note, changing a general stage, reassigning a lead, scheduling/completing an ordinary follow-up, or marking a lead lost.
5. The current stages do not match the requested ten-stage launch pipeline.
6. No assigned-employee notification/reminder mechanism exists.
7. Reports are extensive but only offer preset day ranges and implicit role scope; the required employee, source, arbitrary date range, status, and service-type filters are missing.
8. Lead source management, pipeline management, lead CSV export, and an actual audit-log UI are missing.

**Release conclusion:** the application has much of the storage, intake, dashboard, and reporting infrastructure, but the central staff work loop is incomplete. The nine-step launch completion test cannot currently pass end to end.

## Status legend

- **Achieved** — usable through the current backend and UI for the stated launch need.
- **Partial** — useful foundations exist, but a required path or control is missing.
- **Missing** — no usable implementation was found.
- **Mismatch** — implemented behavior conflicts with the requested launch behavior.

## Requirement-by-requirement audit

| # | Requirement | Status | What is already achieved | What still needs implementation |
|---|---|---|---|---|
| 1 | Authentication and agency security | **Partial / mismatch** | Supabase bearer tokens are verified; active user and agency membership are resolved server-side; lead code derives `agencyId` from `req.auth`; lead records and related tables contain `agency_id`; backend queries are agency-scoped; RLS and tenant tests exist. | Authentication explicitly accepts only `admin`, `consultant`, and `client`. Add supported `manager` and `staff` behavior, lead permissions, routes, navigation, tests, and RLS policies. Define manager agency-wide access and staff-owned/assigned access. Retain `consultant` compatibility for existing case workflows. |
| 2 | Universal lead intake | **Achieved, with operational gaps** | Manual creation, Quick Add UI, public form, CSV preview/commit, generic signed website webhook, Meta/WhatsApp/Google Ads/email/Ooma provider adapters, idempotency, rate limiting, and a background worker exist. | Round-robin owner selection is absent. Duplicate resolution must be completed before intake is operationally safe. A simpler documented generic API/Zapier contract would improve launch readiness. |
| 3 | Lead information | **Partial** | Schema includes identity/contact data, source, service interest, owner, status, priority, created/first/last contact times, next action, follow-ups, activities, conversions, and lost details. | Staff cannot edit normal lead fields after creation or add standalone notes. Loss data cannot be created through an endpoint/UI. Lead detail UI does not present lost detail, conversion actor/date/value, assignment history, or stage history explicitly. |
| 4 | Duplicate prevention | **Partial** | Incoming events normalize phone/email and queue exact lead matches for review. Duplicate candidates show the existing lead identity. | Manual/Quick Add bypasses duplicate checking. Client records are not checked. No preflight/check endpoint exists. No resolution endpoint/UI exists to update/link the existing lead, dismiss the candidate, or record a confirmed duplicate. Add normalized client contact fields or a safe normalized comparison strategy. |
| 5 | Ten-stage launch pipeline | **Mismatch** | A separate operational `status` and funnel `stage` model exists with immutable stage history. | Current stages are `NEW`, `ASSIGNED`, `CONTACTING`, `CONNECTED`, `QUALIFIED`, `CONSULTATION_BOOKED`, `CONSULTATION_COMPLETED`, `RETAINER_PENDING`, `PAYMENT_PENDING`, and `READY_TO_CONVERT`. Align the launch UI and transition rules to New, Assigned, Contact Attempted, Contacted, Consultation Scheduled, Qualified, Not Interested, Follow-up Required, Converted, and Lost. Keep retainer/payment as fields rather than extra visible stages if the launch specification is authoritative. |
| 6 | Lead assignment | **Partial** | Initial manual assignment is required and recorded. Intake streams have configured owners. Assignment-history schema and `ROUND_ROBIN`/`REASSIGNMENT` enum values exist. Current owner is displayed. | No reassignment endpoint/UI, no manager/admin authorization rule, no round-robin selector/state, and no assignment-change activity action. |
| 7 | Contact and activity timeline | **Partial** | Activity types cover calls, WhatsApp, SMS, email, notes, stage/assignment changes, follow-ups, consultation, conversion, and loss. The detail sheet displays activities. System-driven qualification, consultation, commercial, and conversion events are written atomically. | No API/UI lets staff record calls, connected outcomes, WhatsApp/email activity, or a normal note. General status/stage, assignment, follow-up completion, and loss events cannot be produced. Performer details are not included/displayed on timeline rows. |
| 8 | Follow-up system | **Partial** | Follow-up table contains assignee, type, description, due date, pending/completed/cancelled state, completion actor/time, and outcome. Every manually or automatically created open lead gets a next action and follow-up. The database has an open-lead next-action check. Dashboard/report queries calculate due and overdue work. | No create/reschedule/complete/cancel endpoints or UI. No follow-up priority or reminder configuration. `OVERDUE` is calculated from `PENDING + dueAt`, not stored as a status. Completing a follow-up must atomically require/set the next action or terminal outcome. |
| 9 | Employee work dashboard | **Mostly achieved** | Dashboard shows due-today/overdue follow-ups, SLA misses, consultations today, new/uncontacted leads, a prioritized today queue, inactive/missing-action/no-show watchlists, and owner-scoped staff views. | “New leads assigned today” currently means leads created today, not assignments received today. Recent activity is absent. The detail sheet cannot perform most work, so the dashboard is primarily read-only. Add notification state and action shortcuts after lifecycle mutations exist. |
| 10 | Lead details page | **Partial** | One detail sheet shows contact info, source, stage, owner, current next action, follow-ups, consultations, commercial readiness, conversion link, initial inquiry, and activity timeline. | Add edit/contact/note/reassign/follow-up/status/lost actions. Display lost reason, conversion details, activity performer/channel/outcome, notes, and explicit assignment/stage histories. Add consultation outcome updates to the UI; the backend route exists but the current detail UI only books and displays consultations. |
| 11 | Conversion to client | **Achieved with safeguards to add** | Conversion is atomic: creates a client, creates a case, transfers contact/owner context and qualification notes, creates the first case follow-up, cancels pending lead follow-ups, links lead/client/case, records actor/date/value, and writes activity/audit records. UI supports conversion after commercial readiness. | Before conversion, check existing clients to avoid creating a duplicate client. Decide whether the launch should require retainer/payment readiness; that is stricter than the supplied minimum lifecycle. Add a focused end-to-end conversion test through HTTP/UI. |
| 12 | Lost-lead tracking | **Data/report foundation only** | Loss-reason enum, loss-detail table, loss activity type, lost status/time fields, and lost reports exist. Most required reasons are represented. | There is no mark-lost service, route, validation, or UI. Add the exact launch reason list, including “Chose another agency”, “Invalid contact details”, and “Follow-up missed”; require notes for `OTHER`; cancel pending follow-ups; clear next action; and record activity/audit atomically. |
| 13 | Initial reports | **Mostly achieved, blocked by missing event capture** | Funnel, source, employee, loss, response-time, ageing, trend, and workload reports exist. They cover received/contacted/connected/qualified/consultations/conversions/losses, conversion rate, response time, loss reasons, follow-up completion, overdue work, and employee/source attribution. UI renders all eight views. | Missing operational mutation endpoints mean contact/loss/follow-up figures will be incomplete in real use. Add filters for employee, source, arbitrary `from`/`to`, status, and service type; use one shared validated filter builder across reports. Add leads-received/exportable summary as needed. |
| 14 | Admin controls | **Partial** | Admin can create/list/update/disable consultants through existing admin routes. Lead intake connections/forms and retries are managed. Backend activity logs and lead audit writes exist. | Add manager/staff employee management, reactivation/reassignment safety for disabled owners, lead source CRUD, launch pipeline configuration (or intentionally fixed stages), lead CSV export, agency-wide lead activity view, and a real audit-log UI. The current Settings “Activity Logs” section is a placeholder. |

## Minimum source audit

| Source | Current support | Launch assessment |
|---|---|---|
| Phone calls | Quick Add and Ooma/provider intake | Available; Quick Add needs duplicate preflight. |
| Walk-ins | Quick Add with the seeded Walk-in source | Available; Quick Add needs duplicate preflight. |
| WhatsApp | Manual source plus signed provider webhook | Available for intake; no staff activity-recording action. |
| Website | Public form and signed custom website connection | Available. |
| Facebook/Instagram | Seeded sources and Meta connector | Available through Meta/provider configuration; source mapping must be configured per agency. |
| Existing Excel sheets | CSV import | CSV is available; `.xlsx` is not directly supported, which is acceptable if users export Excel sheets to CSV. |
| Referrals | Seeded Referral source and manual entry | Available; there is no structured referrer field beyond message/notes. |

## Essential automation audit

| Rule | Status | Notes |
|---|---|---|
| Warn about duplicate leads | **Partial** | Incoming-event lead matches are queued; manual and client matches are absent, and review cannot be resolved. |
| Record every status change | **Partial** | Several system workflows write history/activity, but there is no general transition service and final loss is unavailable. |
| Mark missed follow-ups overdue | **Partial** | Queries/UI derive overdue from due time; there is no persisted overdue state or scheduled transition. Derived state is acceptable if used consistently and indexed. |
| Notify assigned employee | **Missing** | No lead notification model, in-app notification, email job, or delivery state was found. |
| Flag leads not contacted | **Achieved** | Dashboard counts, SLA miss, today queue, and watchlist cover this. |
| Require a loss reason | **Not reachable** | Schema requires it, but no loss operation exists. |
| Record conversion details | **Achieved** | Actor, client, case, values, and timestamp are stored. |
| Prevent deletion of important history | **Partial** | No lead-history delete API exists and RLS is restrictive, but database triggers reject updates only, not direct deletes. Cascading lead/agency deletion can remove history. Add explicit delete protection/retention rules while preserving controlled agency-retention operations. |

## Launch scenario result today

| Step | Current result |
|---|---|
| 1. Website lead arrives | **Pass** |
| 2. Duplicate is detected | **Partial** — detects existing leads only and stops at unresolved review |
| 3. Lead is assigned | **Pass** — configured stream owner |
| 4. Employee records call result | **Fail** — no endpoint/UI |
| 5. Follow-up is scheduled | **Fail for ordinary staff workflow** — created automatically by some workflows, but no general action |
| 6. Dashboard shows correct day | **Pass if a follow-up exists** |
| 7. Manager inspects timeline | **Fail** — manager cannot authenticate; timeline display exists for admin |
| 8. Convert or mark lost | **Partial** — conversion works; marking lost does not |
| 9. Outcome appears in reports | **Partial** — conversion reports work; loss path is unreachable |

## Ordered implementation plan

Implement the phases in this order. Each phase should ship with backend tests, authorization tests, and the smallest complete UI needed to exercise it.

### Phase 0 — Lock launch semantics and preserve compatibility

**Goal:** remove ambiguity before changing schema and permissions.

1. Adopt lead permissions for `admin`, `manager`, `staff`, and existing `consultant`:
   - Admin: all agency leads and configuration.
   - Manager: all agency leads, reassignment, employee activity, and reports; no agency security/credential administration unless explicitly granted.
   - Staff: owned/assigned leads and their work.
   - Consultant: retain current behavior and treat as staff for lead permissions unless a separate permission is configured.
2. Confirm that the supplied ten-stage pipeline is the launch UI pipeline.
3. Keep `LeadStatus` as the final operational status even if Converted/Lost are displayed as terminal pipeline columns.
4. Keep retainer/payment readiness as fields/checks, not additional visible launch stages. Decide whether they remain mandatory for conversion.
5. Document the stage migration mapping before applying it to existing records.

**Exit criteria:** a written role matrix and stage-transition table are approved and reflected in test fixtures.

### Phase 1 — Fix authentication, authorization, and tenant policy

**Goal:** allow the required people to use the system safely.

1. Update authentication to accept active `manager` and `staff` memberships.
2. Replace `admin`/`consultant` string checks in lead code with centralized lead capabilities (`canViewAllLeads`, `canReassignLead`, `canManageLeadConfiguration`, and similar).
3. Extend lead access scoping so managers see all agency leads while staff/consultants see assigned leads.
4. Update staff/source/consultation validation to accept the intended employee roles.
5. Update RLS policies for manager/staff/consultant compatibility.
6. Add admin employee creation/update/disable/reactivate support for manager and staff roles.
7. Add tests for every role and cross-agency denial on every new lead operation.

**Primary files:** `backend/src/middleware/authMiddleware.js`, `backend/src/middleware/authorization.js`, `backend/src/modules/leads/lead.permissions.js`, `backend/src/server.js`, admin employee controllers/routes, Prisma migration, auth/lead authorization tests, frontend role guards/navigation.

**Exit criteria:** Admin, Manager, Staff, and existing Consultant accounts can log in; each sees exactly the intended agency-scoped lead data.

### Phase 2 — Make duplicate prevention safe for every intake path

**Goal:** never create a lead/client duplicate silently.

1. Extract one agency-scoped duplicate service used by manual creation, public/provider/CSV processing, and conversion.
2. Match normalized phone and email against active leads and existing clients.
3. Add normalized client contact fields and indexes, or implement an indexed migration/backfill strategy that provides equivalent reliable lookup.
4. Add authenticated duplicate preflight for Quick Add/manual entry.
5. Return a structured conflict response containing safe existing-record summaries and allowed actions.
6. Add duplicate-review endpoints and UI actions:
   - open existing lead/client;
   - apply incoming values as an audited update;
   - confirm duplicate and link/close the event;
   - dismiss a false match and create the lead.
7. Record the resolution actor, time, choice, and affected records. Extend duplicate status if needed (for example `MERGED` or `LINKED`).
8. Recheck duplicates inside the creation/conversion transaction to prevent race conditions.

**Exit criteria:** manual, website, webhook, CSV, and conversion paths all detect existing leads/clients and require an explicit resolution.

### Phase 3 — Implement the operational lead command API

**Goal:** support the daily staff work loop atomically.

Create focused commands rather than a permissive generic lead update:

1. `PATCH /leads/:id` — edit allowed identity/contact/interest/priority fields with duplicate recheck.
2. `POST /leads/:id/assignments` — assign/reassign, enforce permissions, update owner/next-action owner as chosen, and write assignment history/activity/audit.
3. `POST /leads/:id/activities` — record call attempted, call connected, WhatsApp sent, email sent, and internal note; update first/last contact timestamps and stage where appropriate.
4. `POST /leads/:id/follow-ups` — schedule a follow-up and synchronize the lead’s current next action.
5. `PATCH /leads/:id/follow-ups/:followUpId` — complete, reschedule, or cancel with required outcome.
6. `POST /leads/:id/transitions` — validated stage/status transitions with a transition matrix and immutable history.
7. `POST /leads/:id/lost` — require a supported reason, cancel pending work, clear next action, set status/time, and write loss/activity/audit records.
8. Ensure any operation leaving a lead `OPEN` also leaves one valid pending next action; do this in the same transaction.
9. Use optimistic version checking for concurrent staff updates.

**Exit criteria:** one employee can record contact, schedule/complete follow-up, reassign when permitted, move stages, add notes, and mark a lead lost without direct database changes.

### Phase 4 — Align the launch pipeline and loss taxonomy

**Goal:** make the visible workflow match the supplied minimum.

1. Add the ten requested display stages and an explicit transition map.
2. Migrate existing stages deliberately, for example:
   - `CONTACTING` -> Contact Attempted;
   - `CONNECTED` -> Contacted;
   - `CONSULTATION_BOOKED` -> Consultation Scheduled;
   - commercial pending stages -> Follow-up Required;
   - `READY_TO_CONVERT` -> Qualified or a readiness flag while status stays open.
3. Display Converted and Lost as terminal pipeline outcomes backed by `LeadStatus` and conversion/loss records.
4. Align loss reasons to the exact launch list. Preserve old codes with a migration mapping where required.
5. Seed fixed stages unless admin customization is confirmed as a launch requirement. Avoid building multiple custom pipelines.

**Exit criteria:** every lead has one understandable launch stage, transitions are validated, and terminal outcomes have required records.

### Phase 5 — Complete the staff lead workspace

**Goal:** make the detail screen the place where staff complete the lifecycle.

1. Add contact-result actions for call attempted/connected, WhatsApp, and email.
2. Add note entry, edit lead, schedule/reschedule/complete follow-up, and stage change controls.
3. Add manager/admin reassignment and mark-lost controls.
4. Show activity performer, channel, direction, outcome, notes, and full timestamp.
5. Show assignment history, stage history, follow-up outcomes, consultation details/outcomes, conversion details, and lost reason.
6. Add duplicate-warning/resolution UI to Quick Add and intake events.
7. Refresh the detail record after every mutation and handle optimistic-version conflicts clearly.

**Exit criteria:** a staff member can complete steps 3–8 of the launch scenario from the lead detail screen.

### Phase 6 — Notifications, reminders, and actionable dashboard

**Goal:** every employee knows whom to contact next.

1. Add durable in-app notifications for new assignment/reassignment, upcoming follow-up, overdue follow-up, and first-response breach.
2. Add a scheduler/worker with idempotent notification jobs and retry state; optionally deliver email after in-app delivery is reliable.
3. Treat overdue as a derived state unless a persisted status is required; centralize the calculation so dashboard, list, detail, and reports agree.
4. Add “assigned today” from assignment history rather than lead creation time.
5. Add recent activity and one-click action shortcuts to the dashboard.
6. Add notification read/dismiss state and per-user preferences only to the degree needed for launch.

**Exit criteria:** assignment and due-work notifications are durable, non-duplicating, and lead the employee directly to the correct action.

### Phase 7 — Complete reports and filters

**Goal:** make operational reporting accurate and auditable.

1. Build one validated report filter object for `employeeId`, `sourceId`, `from`, `to`, `status`, and `serviceType`.
2. Apply identical tenant/role/filter semantics to all report queries.
3. Populate contact, follow-up, and loss metrics from the new command records.
4. Add Contacted vs Not Contacted and Follow-ups Completed vs Overdue summaries if not sufficiently visible in existing views.
5. Add filter controls, active-filter display, reset, empty states, and timezone-aware date handling to the reports UI.
6. Add report tests covering combined filters and manager/staff scoping.

**Exit criteria:** managers can reproduce counts by employee, source, date range, status, and service type, and drill into the underlying scoped leads.

### Phase 8 — Complete admin launch controls

**Goal:** remove operational dependence on developers.

1. Add lead source create/rename/enable/disable controls. Prevent disabling a source in ways that break historical records or active connections.
2. If pipeline stages are fixed for launch, present them read-only with clear transition rules; otherwise implement limited ordering/label controls without multiple pipelines.
3. Add agency-scoped lead CSV export with the same filters as the lead list and safe spreadsheet escaping.
4. Build the Activity Logs settings panel and an agency-wide lead-activity view for authorized managers/admins.
5. Add reassignment workflow when disabling an employee who still owns open leads/follow-ups/connections.
6. Add retention protection against deleting lead activities, stage history, assignment history, loss details, and conversions outside an explicit privileged retention process.

**Exit criteria:** an admin can manage employees/sources, safely handle disabled owners, export leads, and inspect audit history without database access.

### Phase 9 — End-to-end release verification

**Goal:** prove the first usable production version.

Automate and manually verify this exact flow for two agencies and all required roles:

1. Submit a website lead.
2. Confirm lead/client duplicate checking and resolve any candidate.
3. Assign or reassign the lead and receive the notification.
4. Record a call attempt and connected outcome.
5. Schedule a follow-up and verify the correct agency-local dashboard day.
6. Complete the follow-up with an outcome and a new next action.
7. Inspect the complete timeline as manager.
8. Run one conversion path and one lost path.
9. Confirm client/case linkage, preserved lead timeline, cancelled lead follow-ups, loss reason, reports, CSV export, and audit events.
10. Attempt cross-agency access and unauthorized manager/staff/admin operations.

Also run:

- Prisma schema validation and migrations against a production-like database;
- backend unit/integration tests;
- frontend production build;
- intake-worker retry/idempotency tests;
- duplicate race/concurrency tests;
- backup/restore and deployment smoke tests.

**Exit criteria:** all nine supplied launch-completion steps pass end to end, with tenant isolation and audit evidence.

## Recommended implementation slices

Use small vertical pull requests in this order:

1. Role/capability matrix + auth/RLS/tests.
2. Shared duplicate service + manual preflight + client matching.
3. Duplicate-resolution API/UI.
4. Activity/contact command + timeline performer details.
5. Follow-up command set + next-action invariant.
6. Reassignment command + manager UI.
7. Lost command + reason UI/report proof.
8. Pipeline alignment/migration.
9. Lead detail workspace completion.
10. Notifications + dashboard enhancements.
11. Shared report filters.
12. Source management + lead export + audit UI.
13. Full lifecycle E2E and production runbook update.

## Existing files and components to reuse

### Backend

- `backend/src/middleware/authMiddleware.js`
- `backend/src/middleware/authorization.js`
- `backend/src/modules/leads/lead.routes.js`
- `backend/src/modules/leads/lead.controller.js`
- `backend/src/modules/leads/lead.service.js`
- `backend/src/modules/leads/lead.validation.js`
- `backend/src/modules/leads/lead.permissions.js`
- `backend/src/modules/leads/lead.repository.js`
- `backend/src/modules/leads/lead.intake.service.js`
- `backend/src/modules/leads/lead.intake.worker.js`
- `backend/src/modules/leads/lead.dashboard.service.js`
- `backend/src/modules/leads/lead.report.service.js`
- `backend/src/utils/prismaCrud.js`
- `backend/prisma/schema.prisma`

### Frontend

- `frontend/src/modules/leads/pages/LeadsPage.jsx`
- `frontend/src/modules/leads/pages/LeadDashboardPage.jsx`
- `frontend/src/modules/leads/pages/LeadReportsPage.jsx`
- `frontend/src/modules/leads/pages/LeadIntakePage.jsx`
- `frontend/src/modules/leads/components/QuickAddLeadSheet.jsx`
- `frontend/src/modules/leads/components/LeadDetailSheet.jsx`
- `frontend/src/modules/leads/components/BookConsultationSheet.jsx`
- `frontend/src/modules/leads/components/ConvertLeadSheet.jsx`
- `frontend/src/modules/leads/leadPresentation.js`
- `frontend/src/services/api.js`

## Baseline verification performed during this audit

- Backend test suite: **63 passed, 0 failed**.
- Prisma schema validation: **passed**.
- Frontend production build: **passed**.
- Build warnings: several large frontend chunks and an ineffective DOMPurify dynamic import. These are performance concerns, not blockers for this lead lifecycle analysis.

The current tests validate important foundations, but they do not cover the missing operational commands because those commands do not yet exist. The final release gate must add HTTP-level and end-to-end tests for the full lifecycle rather than relying only on service mocks and schema-text assertions.
