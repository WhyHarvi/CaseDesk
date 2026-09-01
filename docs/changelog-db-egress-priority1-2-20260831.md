# Database Egress Fixes — Priority 1 & 2 (2026-08-31)

This release ships the next two items from the ongoing database-egress cleanup (see `docs/DATABASE_EGRESS_INVESTIGATION.md`, "Remaining hotspots" / "Further course of action," Priorities 1 and 2). It follows two earlier production fixes (`6d04407`, `3fd15ea`) already documented there — this is an increment, not a replacement.

## 1. Summary of the change

- **Commit `1cb93b0`** — The background job that decides who to notify (about tasks, follow-ups, documents, questionnaires, leads, and communication SLAs) used to re-check "is this person still active, on this agency, permitted, and does their notification preference allow this" separately for every single candidate notification — about 5,292 times per query shape over 44 hours, 201,096 rows total, 35% of the top-50 tracked query load. It now looks up all of that once per scheduler pass per agency instead. Also fixed a spot where one notification type (`communicationSlaNotifications`) was accidentally running its admin-fallback lookup twice per conversation.
- **Commit `6774a69`** — The worker that matches incoming emails to client case files by their unique client identifier (UCI) used to reread the entire backlog of unmatched messages every single hour, regardless of whether anything had changed — 51 seconds of database time per pass, ~29% of all tracked database execution time. It now checks new messages immediately when they arrive, only rechecks messages that were never checked or previously failed, and re-attempts matching immediately when a case's UCI is added or changed. This required a small, additive database schema change (three new optional columns, two new indexes).

Files touched: `backend/src/services/notificationAccessService.js`, `backend/src/services/notificationService.js`, `backend/src/services/notificationScheduler.js`, `backend/src/controllers/communicationWebhookController.js`, `backend/src/services/uciCommunicationMatchingService.js`, `backend/src/controllers/caseApplicantController.js`, plus a new Prisma migration (`backend/prisma/migrations/20260831170000_incremental_uci_matching/migration.sql`) and new/updated tests.

Note for anyone scanning `git log`: commit `b41cbcc` ("Add selectable outbound caller IDs," Twilio-related) landed between the two egress commits on `origin/main` but is unrelated to this release — don't attribute it to this work.

## 2. User-facing vs internal

**User-facing (what a CaseDesk user might notice):** None expected. No UI changes, no change to which notifications a user receives or when, no change to scheduler cadence or worker polling intervals. New emails should get matched to the correct client/case at least as fast as before (immediately at ingestion in most cases, rather than waiting for the hourly pass).

**Internal-only:**
- How often and how the notification scheduler queries user/membership/permission/preference data (batched instead of per-candidate).
- Fixed a duplicate admin-fallback query in communication-SLA notifications.
- How the UCI-matching worker decides what to rescan (incremental instead of full backlog) — including three new nullable columns (`extractedUci`, `uciCheckedAt`, `uciCheckFailedAt`) on `UnmatchedCommunication` and two new indexes.
- New immediate-check-at-ingestion and immediate-recheck-on-UCI-change code paths.

## 3. Rollback note

**Commit `1cb93b0` (Priority 1 — batch recipient validation): LOW rollback risk.**
Pure application-code change, no schema migration. Rollback is a straightforward commit revert / redeploy of the prior application version. No data to reverse. The one thing to be aware of: this touches an authorization/tenant boundary (who gets notified), so it was independently verified via a behavioral-equivalence test to produce identical recipient sets to the old per-candidate path (multi-recipient, fallback-admin, and mixed active/inactive/no-permission cases) — but that's a pre-deploy verification note, not a rollback complication.

**Commit `6774a69` (Priority 2 — incremental UCI matching): LOW-MEDIUM rollback risk, primarily because of a deployment prerequisite, not because the change itself is risky.**
- The schema migration is additive-only (new nullable columns, new indexes, `IF NOT EXISTS`, no drops/renames/new-NOT-NULL columns) — confirmed via `npx prisma validate` and manual SQL review.
- **As of this writing, the migration has NOT yet been applied to the live database** (`prisma migrate status` shows it pending). Deployment must include running this migration; being additive-only, it should apply without downtime, but this is a required deployment step, not something already done.
- Code-only rollback (reverting `6774a69` without reversing the migration) is safe: the new columns are nullable/additive, so leaving them in place after an app-code rollback causes no data loss or breakage in either direction.
- One documented, deliberate behavior (not a new regression): `storeUnmatched()`'s `unmatched: true` return value is unchanged even when a message is immediately linked at ingestion, to avoid rippling into unrelated lead-intake logic (`inboundMailSyncService.js`). This makes a pre-existing quirk (a message could already be both matched and lead-enqueued before this change, previously hidden by an hour's delay) visible sooner. Flagged as a candidate for a separate follow-up ticket — not fixed in this release, not a regression introduced by it.

## 4. Changelog entry

```
## 2026-08-31 — Database egress: batch notification recipient validation, incremental UCI matching

- Notification scheduler (tasks, follow-ups, documents, questionnaires, leads,
  communication SLAs) now resolves active users, memberships, permissions,
  and notification preferences once per scheduler pass per agency, instead
  of once per notification candidate. Eliminates ~201,000 rows / ~5,292
  redundant query executions per 44-hour period (35% of top-50 tracked
  query rows). Also fixes a duplicate admin-fallback lookup in
  communication-SLA notifications. No change to notification eligibility,
  scheduler cadence, or delivery timing. (1cb93b0)

- UCI (unique client identifier) email-matching worker no longer rereads
  the entire unresolved-message backlog every hour. New messages are
  checked for a UCI match at ingestion; the hourly pass now only rescans
  messages that were never checked or previously failed; a case's UCI
  being added or changed now triggers an immediate targeted recheck.
  Adds three nullable columns and two indexes to UnmatchedCommunication
  (additive migration). Reduces the ~51s/hour of database execution time
  (~29% of top-50 tracked execution time) previously spent rereading
  message bodies across the full backlog. Worker cadence remains hourly.
  (6774a69)

Both changes are part of the ongoing egress-reduction effort documented in
docs/DATABASE_EGRESS_INVESTIGATION.md (Priorities 1 and 2). Remaining
backlog items (Priorities 3-6: full-message polling removal, batched
notification dedupe, reduced reconciliation scans, write-time deadline
scheduling) are not part of this release.
```

## 5. Manual verification checklist for after deploy

- [ ] Run the pending Prisma migration (`20260831170000_incremental_uci_matching`) against the live database as part of deployment — confirm `prisma migrate status` shows it applied.
- [ ] Spot-check that notifications are still being delivered to the expected recipients post-deploy (e.g. a task assignment, a lead follow-up) for at least one multi-user agency.
- [ ] Confirm a newly received email with a UCI in the body gets matched promptly (ingestion-time), not just on the next hourly pass.
- [ ] Confirm updating a case applicant's UCI triggers matching of any previously-unmatched backlog messages for that UCI.
- [ ] After 24-48h, pull a fresh top-50 query-workload capture and confirm the three membership/permission query shapes and the full-backlog UCI scan shape have dropped as expected (compare against the "Remaining hotspots" table in the investigation doc).
- [ ] No action needed on the frontend — `CommunicationWorkspace.jsx` only destructures named fields and is unaffected by the new columns.

## Rollback risk summary (quick reference)

| Commit | Component | Rollback risk | Reason |
|---|---|---|---|
| `1cb93b0` | Batch recipient validation | **LOW** | Pure app-code change, no migration, plain revert-and-redeploy |
| `6774a69` | Incremental UCI matching | **LOW-MEDIUM** | Migration is additive/nullable (safe either direction), but migration must be applied as a deployment step (not yet applied as of writing) |

---

Files referenced (all absolute paths):
- `/Users/harvi/Emerks/casedesk/docs/DATABASE_EGRESS_INVESTIGATION.md` (source investigation doc)
- `/Users/harvi/Emerks/casedesk/backend/src/services/notificationAccessService.js`
- `/Users/harvi/Emerks/casedesk/backend/src/services/notificationService.js`
- `/Users/harvi/Emerks/casedesk/backend/src/services/notificationScheduler.js`
- `/Users/harvi/Emerks/casedesk/backend/test/notificationSchedulerBatching.test.js`
- `/Users/harvi/Emerks/casedesk/backend/test/webPush.test.js`
- `/Users/harvi/Emerks/casedesk/backend/src/controllers/communicationWebhookController.js`
- `/Users/harvi/Emerks/casedesk/backend/src/services/uciCommunicationMatchingService.js`
- `/Users/harvi/Emerks/casedesk/backend/src/controllers/caseApplicantController.js`
- `/Users/harvi/Emerks/casedesk/backend/prisma/migrations/20260831170000_incremental_uci_matching/migration.sql`
- `/Users/harvi/Emerks/casedesk/frontend/src/components/case-profile/CommunicationWorkspace.jsx` (confirmed unaffected)
