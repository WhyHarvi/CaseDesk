# Database Egress Investigation and Optimization Plan

**Project:** CaseDesk  
**Investigation period:** August 29–31, 2026  
**Status:** Initial containment and cross-replica fixes deployed; durable optimizations remain

## Executive summary

CaseDesk was repeatedly retrieving large sets of unchanged database records. The main causes were broad deadline scans, application-side notification deduplication, repeated recipient validation, full communication-message payload polling, and background workers running independently in every backend replica.

Two production changes were implemented:

- `6d04407` — **Reduce notification and communication egress**
- `3fd15ea` — **Prevent duplicate egress worker scans**

After both changes, the top-50 query workload improved substantially relative to the last pre-lock baseline:

| Metric | Previous baseline | Post-fix period | Change |
| --- | ---: | ---: | ---: |
| Calls per minute | 154.6 | 65.7 | **-57.5%** |
| Rows per minute | 1,594.2 | 651.3 | **-59.1%** |
| Database execution time per minute | 256.8 ms | 66.2 ms | **-74.2%** |

The distributed worker lease is operating as intended: deadline scans now execute approximately once every 10 minutes across the deployment, notification reconciliation once every 5 minutes, and UCI matching once per hour. The UCI scan no longer retrieves `raw_payload` or other unnecessary provider fields.

The largest remaining opportunities are batching user/membership validation, making UCI reconciliation incremental, and eliminating full communication-message payload polling.

## Measurement method and limitations

The analysis used period deltas derived from PostgreSQL statement statistics. All captures have the same statistics-reset timestamp:

`2026-07-07 20:19:35.788985+00`

This means the captures can be compared without a reset invalidating the deltas. Capture intervals were normalized to per-minute rates because their durations differ.

| Captured at (UTC) | Query shapes |
| --- | ---: |
| 2026-08-29 17:40:56 | 4,838 |
| 2026-08-29 17:55:27 | 4,844 |
| 2026-08-29 18:06:22 | 4,845 |
| 2026-08-29 18:18:45 | 4,850 |
| 2026-08-29 18:29:24 | 4,850 |
| 2026-08-31 14:40:03 | 4,898 |

Important limitations:

- The exports contain the top 50 query shapes, not every database query.
- PostgreSQL rows returned are a proxy for egress, not an exact byte measurement.
- A row containing HTML, JSON, attachments, transcripts, or provider payloads can be far larger than an ID-only row.
- `query_shapes` is not an egress metric. Prisma parameter-count variations, migrations, deployments, and new SQL statements can increase it.
- Application traffic varied between capture periods, so scheduler frequency and query payload shape are stronger evidence than raw totals alone.

## Original issues

### 1. Lead follow-up scheduler rereads

**Query ID:** `-6410023903813225633`

The scheduler selected up to 500 pending lead follow-ups due within a seven-day horizon. Pending or overdue records remained eligible and were downloaded again on every pass.

The original sample returned 6,706 rows across 14 calls, approximately 479 rows per execution.

### 2. Lead deadline scheduler rereads

**Query ID:** `-3432949592115970295`

The scheduler repeatedly retrieved open or nurture leads whose first-contact deadline, next action, or nurture date was before the horizon. Overdue leads remained eligible indefinitely.

The original sample returned 3,346 rows. Combining three deadline conditions with `OR` also limits efficient index use.

### 3. Notification sidebar over-fetch

**Query ID:** `-4189924095234473592`

The interface needed the newest unread notification for each destination. Prisma's `distinct` behavior caused PostgreSQL to return approximately 168 unread notifications per poll before application-side deduplication.

The original sample returned 3,364 rows from 20 calls.

### 4. Repeated user and membership validation

**Query IDs:**

- `-5250513854712730788`
- `4582376589083357882`
- `-3162155603659990134`

Notification candidates were processed individually. The application repeatedly loaded active users, agency memberships, roles, and permissions instead of resolving recipients once per scheduler pass.

### 5. General follow-up scheduler rereads

**Query ID:** `-2469934482016041943`

Pending follow-ups were repeatedly selected through broad overdue, reminder, and due-soon conditions. Old pending work remained eligible on every pass.

### 6. Repeated related-client loading

**Original query ID:** `7865337649517665720`

Client identities and email addresses were repeatedly loaded for the same scheduler candidates, including candidates that ultimately required no new notification.

### 7. Full communication-message polling

**Observed query IDs included:**

- `-3829042616312908760`
- `9068997022281328807`
- `-4632812569804779766`
- `-4649386570073657988`
- `-8790378935180220948`

List and polling paths retrieved complete communication messages, including fields such as:

- Plain-text and HTML bodies
- Recipient, CC, BCC, and reply-to arrays
- Attachment metadata
- Provider metadata
- Call recordings and transcripts
- Delivery and failure details

These rows are likely among the largest contributors by bytes even when their row count is lower than scheduler queries.

### 8. Notification resolution scanning

**Query ID:** `-6032018517959423903`

The scheduler reread unresolved notifications to determine whether related entities had completed. This was a safety reconciliation path acting too much like a primary state-management mechanism.

### 9. Cross-replica worker duplication

After the first optimization, identical deadline queries still appeared six times in a capture. Their result sizes were identical per call, indicating that multiple backend replicas were independently running the same in-process scheduler.

Changing an interval from one minute to ten minutes reduced frequency per replica but did not provide deployment-wide exclusivity.

### 10. Full unmatched-communication backlog scan

**Original query IDs:** `-880753512326918572`, `7833791141297179452`

The UCI matching worker paginated through the complete unresolved-email backlog. Prisma's default selection retrieved full rows containing `body_text`, recipients, provider data, and `raw_payload`.

One captured startup/hourly pass produced 4,034 rows and 7.37 seconds of database execution time. The largest query ran in nearly full 100-row pages.

## Changes implemented

### Commit `6d04407`: Reduce notification and communication egress

#### Scheduler containment

- Retained the one-minute worker heartbeat for responsive housekeeping.
- Limited broad deadline scans to once every 10 minutes per process.
- Kept notification entity reconciliation bounded and cursor-based.
- Reduced reconciliation frequency and batch size rather than restarting an unbounded scan every minute.

This was intentionally a containment measure. It reduced how often the same backlog was downloaded but did not change the number of rows returned per execution.

#### Database-side notification deduplication

- Replaced Prisma/application-side destination deduplication with PostgreSQL `DISTINCT ON (destination_key)`.
- Preserved newest-per-destination behavior using `ORDER BY destination_key, last_occurred_at DESC`.
- Prevented PostgreSQL from transmitting all unread notification details merely for application code to discard duplicates.

The original high-row sidebar detail query subsequently disappeared from the top-50 captures.

#### Communication inbox summaries

- Added a dedicated list include/select shape.
- Limited conversation lists to the newest message preview and required related metadata.
- Avoided loading full histories for ordinary inbox refreshes.

#### Polling reductions

- Notification polling: 45 seconds to 5 minutes.
- Chat reconciliation with realtime: 45 seconds to 5 minutes.
- Chat fallback polling: 10 seconds to 60 seconds.
- Ambient floating-widget list polling: 20 seconds to 5 minutes.
- Chats list and email detail safety polling: approximately 2 minutes.
- Case communication workspace safety polling: 20 seconds to 2 minutes.

These remain safety polls; realtime and user-driven loads provide the interactive path.

#### In-process notification dedupe cache

- Added a bounded, expiring cache for known non-aggregate notification dedupe keys.
- Repeated scheduler calls for the same notification can skip eligibility, preference, push-token, and upsert work within a process.

### Commit `3fd15ea`: Prevent duplicate egress worker scans

#### Database-backed distributed worker lease

- Added the `worker_leases` table and Prisma model.
- Implemented atomic lease acquisition with `INSERT ... ON CONFLICT ... DO UPDATE ... WHERE`.
- Allowed the current process to renew its lease.
- Allowed another replica to take over after lease expiration if the owner stops.
- Applied the lease to the notification scheduler and UCI communication-matching worker.

This made scheduler cadence deployment-wide instead of per replica.

#### Narrow two-stage UCI scanning

The backlog scan now selects only:

- `id`
- `subject`
- `body_text`

The application runs the UCI pattern check on this narrow result. Only a row containing a possible UCI receives a second targeted lookup for fields required to link it. `raw_payload` is not retrieved by either path.

## Verification performed

For the second change:

- 24 targeted notification, UCI, and worker-lease tests passed.
- Prisma schema validation passed.
- Backend syntax and diff checks passed.
- Frontend production build passed.
- The repository-wide backend suite passed 946 of 967 tests; 21 existing source-contract failures were outside the changed files.
- The worktree was clean when the commit was pushed.

## Production results

### First-fix observation

The capture ending at `2026-08-29 18:29:24 UTC` was taken 19 seconds before commit `3fd15ea` was created, so it measured the first fix only.

Compared with the preceding period:

| Metric | Previous period | First-fix period | Change |
| --- | ---: | ---: | ---: |
| Calls per minute | 294.6 | 154.6 | -47.5% |
| Rows per minute | 2,676.9 | 1,594.2 | -40.4% |
| Database execution time per minute | 1,045.7 ms | 256.8 ms | -75.4% |

The sidebar over-fetch and large notification-dedupe spike disappeared, but two identical deadline executions still demonstrated cross-replica duplication.

### Post-lock observation

The capture from `2026-08-29 18:29:24 UTC` through `2026-08-31 14:40:03 UTC` spans approximately 44 hours and 10 minutes.

Top-50 totals during this period:

- 174,167 calls
- 1,726,437 rows
- 175.54 seconds of database execution time

Normalized results:

| Metric | First-fix baseline | Post-lock period | Change |
| --- | ---: | ---: | ---: |
| Calls per minute | 154.6 | 65.7 | **-57.5%** |
| Rows per minute | 1,594.2 | 651.3 | **-59.1%** |
| Database execution time per minute | 256.8 ms | 66.2 ms | **-74.2%** |

Observed cadence confirms the distributed lease:

- Lead deadline scans: 265 calls, approximately one every 10 minutes.
- Notification entity reconciliation: 529 calls, approximately one every 5 minutes.
- UCI worker first-page query: 44 calls, approximately one per hour.
- UCI cursor-page query: 880 calls, approximately 20 additional pages per hourly pass.

The new UCI query shape selects only `id`, `subject`, and `body_text`. The old full-row query containing `raw_payload` is absent.

## Remaining hotspots

| Query family | Calls | Rows | Execution time | Share of top-50 rows |
| --- | ---: | ---: | ---: | ---: |
| User and membership validation | 15,876 | 603,288 | 6.03 s | 35.0% |
| Full communication messages | 5,247 | 175,029 | 9.54 s | 10.1% |
| Lead/follow-up deadline scans | 795 | 214,134 | 15.91 s | 12.4% |
| Notification entity reconciliation | 529 | 117,935 | 5.18 s | 6.8% |
| Narrow UCI backlog scan | 924 | 89,823 | 51.07 s | 5.2% |
| Notification dedupe lookup | 11,956 | 8,298 | 5.67 s | 0.5% |

Although the narrow UCI scan accounts for only 5.2% of rows, it accounts for approximately 29% of top-50 database execution time because it rereads message bodies across the unresolved backlog every hour.

The three recipient-validation queries each ran 5,292 times and returned 201,096 rows. Together they are now the clearest row-egress target.

## Further course of action

### Priority 1: Batch scheduler recipient validation

**Goal:** Resolve recipient eligibility once per scheduler pass rather than once per notification candidate.

Proposed implementation:

1. Collect unique candidate recipient IDs grouped by agency.
2. Fetch active users and memberships once for each agency/pass.
3. Load permissions and notification preferences in batches.
4. Build a pass-scoped recipient eligibility map.
5. Pass resolved recipient data into notification creation.
6. Preserve database uniqueness as the final concurrency guard.

Acceptance criteria:

- The three membership query shapes fall from approximately 5,292 calls each per 44 hours to a small number proportional to scheduler passes and agencies.
- Notification behavior and authorization remain unchanged.
- Multi-recipient and fallback-admin cases have regression coverage.

### Priority 2: Make UCI matching incremental

**Goal:** Stop rereading the complete unresolved-email backlog every hour.

Recommended design:

- Persist a UCI-check state such as `uci_match_checked_at`, extracted UCI, or a durable processing cursor.
- Check new unmatched communications during ingestion or enqueue a durable matching job.
- Recheck previously unmatched UCI candidates only when relevant client/case UCI data changes.
- Retain a slow, bounded reconciliation pass as a safety net.

Acceptance criteria:

- Steady-state hourly scans are proportional to new or changed unmatched messages, not the full backlog.
- Newly received IRCC messages cannot be hidden behind another agency's backlog.
- Failed rows remain retryable without repeatedly downloading every noncandidate body.

### Priority 3: Remove remaining full-message polling

**Goal:** Ensure list, badge, preview, and safety-refresh paths never retrieve complete messages.

Proposed implementation:

- Audit every controller producing the remaining full-message query shapes.
- Use explicit summary selects for conversation lists.
- Load full bodies only when a user opens a conversation or message.
- Load attachments and call transcripts through separate detail paths.
- Use `id > last_seen_id` or `(occurred_at, id)` cursors for incremental refreshes.
- Ensure the Chats page, floating widget, and case workspace do not independently poll the same data.

Acceptance criteria:

- No recurring list/poll query selects `body_html`, `call_transcript`, attachment JSON, and provider metadata together.
- Full-message queries correlate with explicit detail views rather than background intervals.

### Priority 4: Batch notification dedupe checks

**Goal:** Replace one dedupe lookup per candidate with one lookup per scheduler batch.

Proposed implementation:

- Generate candidate dedupe keys before notification creation.
- Fetch existing `(agency_id, recipient_user_id, dedupe_key)` tuples with batched predicates.
- Remove existing tuples from the worklist in memory.
- Keep the unique constraint/upsert as the race-condition safeguard.

Acceptance criteria:

- The current 11,956-call dedupe query is reduced by at least an order of magnitude.
- Duplicate notifications remain impossible across replicas.

### Priority 5: Reduce reconciliation scans

**Goal:** Treat reconciliation as a safety net rather than the primary resolution path.

Proposed implementation:

- Resolve notifications within the transactions that complete, cancel, archive, or otherwise close their related entities.
- Track recently changed entities for bounded reconciliation.
- Move stable safety scans toward an hourly cadence after write-time coverage is verified.
- Review the once-per-minute missing-payment-alert reconciliation and make it event-driven or less frequent.

Acceptance criteria:

- Resolution scans decrease without leaving stale actionable notifications.
- Completion/cancellation flows include direct-resolution tests.

### Priority 6: Transition deadline notifications to write-time scheduling

**Goal:** Stop broad `<= horizon` queries from rereading unchanged overdue records.

Recommended architecture:

- Create or update scheduled-notification records when deadlines are created or changed.
- Cancel or replace scheduled notifications when dates, assignees, or statuses change.
- Let a delivery worker claim only notification jobs that become due.
- Keep a bounded reconciliation worker for missed events and deployment recovery.

This is the durable replacement for repeatedly scanning lead follow-ups, leads, general follow-ups, documents, questionnaires, and communication SLA deadlines.

Acceptance criteria:

- Deadline query volume becomes proportional to newly due or modified work.
- Overdue records do not remain permanently eligible for broad scans.
- Timeliness is maintained without relying on short global polling intervals.

## Recommended measurement improvements

Rows alone cannot quantify network egress. Add or capture:

- Estimated payload bytes using `pg_column_size` for representative result shapes.
- API response byte counts by endpoint and route.
- Scheduler pass metrics: candidates scanned, notifications skipped, created, and updated.
- Worker lease acquisition/skip counts by worker and replica.
- Realtime connection state and fallback-poll counts.
- Per-query logical family grouping so Prisma `IN (...)` parameter-count variants are analyzed together.

For each deployment, compare at least one stable 30–60 minute window and one 24-hour window. Record deployment time so startup scans and rolling-replica overlap are not mistaken for steady-state behavior.

## Final assessment

The first phase successfully contained the egress problem and removed deployment-wide duplicate worker execution. The measured row rate fell by approximately 59%, and query execution load fell by approximately 74% relative to the last pre-lock baseline.

The system is materially improved but not yet at its durable target. Recipient validation still causes the most returned rows, the UCI worker still rereads old message bodies hourly, and several communication paths still retrieve complete messages during recurring refreshes. Addressing those three areas should provide the next largest reduction in actual transferred bytes.
