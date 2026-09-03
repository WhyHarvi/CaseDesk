# CaseDesk Architecture Safety Rules

The workflow in this file is mandatory for every future coding task that modifies existing CaseDesk behavior, architecture, database, API, business rules, permissions, integrations, or shared components.

Before modifying an existing CaseDesk feature:

1. Read `docs/README.md`.
2. Read the relevant feature documentation.
3. Follow its `Depends On` links.
4. Inspect related database models.
5. Inspect affected API endpoints.
6. Inspect frontend consumers.
7. Inspect external integrations.
8. Inspect existing tests.

# Mandatory Change Workflow

For any request that modifies existing CaseDesk behavior, architecture, database, API, business rules, permissions, integrations, or shared components, complete every applicable phase below.

## Phase 1 — Understand

Before writing code:

1. Read `docs/README.md`.
2. Identify the primary feature being changed.
3. Read its corresponding document under `docs/Features/`.
4. Follow all relevant `[[Depends On]]` and related architecture links.
5. Read relevant database model documentation.
6. Read relevant integration documentation.
7. Verify important architectural claims against actual source code.

Documentation is a navigation aid, not absolute truth. Actual code remains the final source of truth.

## Phase 2 — Change Impact Analysis

Before implementation, always produce a concise:

### Change Impact Analysis

- Primary feature
- Related features
- Dependency chain
- Database models affected
- Backend files affected
- Frontend files affected
- Integrations affected
- Authentication/authorization impact
- Tenant-isolation impact
- Business-rule impact
- Side effects
- Possible regressions
- Existing tests that must pass
- Missing test coverage
- Risk level: low / medium / high / critical

For low-risk isolated changes, this analysis may be brief.

For high- or critical-risk changes, it must be detailed before implementation begins.

## Phase 3 — Implementation Boundary

Before coding, explicitly state:

### Modify

Files and systems expected to require changes.

### Do Not Modify

Adjacent systems that should remain untouched.

This boundary is intended to prevent unnecessary architectural spread.

## Phase 4 — Implementation

When implementation begins:

1. Prefer the smallest safe change.
2. Do not refactor unrelated systems.
3. Preserve tenant isolation.
4. Preserve existing authorization boundaries.
5. Preserve backward compatibility unless the task explicitly requires breaking behavior.
6. Never modify historical financial or audit records destructively unless specifically required.
7. Do not modify the database schema unless existing models cannot safely represent the requirement.
8. Avoid introducing duplicate functionality if the requested behavior already exists.

If repository inspection shows that the requested feature already exists, **stop implementation** and explain what already exists instead of rewriting it.

## Phase 5 — Validation

After implementation:

1. Run directly affected tests.
2. Run tests protecting upstream and downstream dependencies when risk is high or critical.
3. Add tests for newly discovered regression paths.
4. Confirm tenant isolation.
5. Confirm permissions.
6. Confirm important side effects.

For financial workflows, also verify:

- Totals
- Ledger integrity
- Idempotency
- Concurrency where relevant
- Provider reconciliation
- Audit history

## Phase 6 — Documentation Sync

After implementation:

Update architecture documentation only when actual architecture or behavior changed.

Update, as applicable:

- Relevant `docs/Features/*.md`
- Relevant `docs/Database/*.md`
- Relevant `docs/Integrations/*.md`
- `docs/00-System/System-Map.md` if relationships changed

Update dependency links when architecture changed. Do not update documentation merely because code formatting or implementation details changed.

If a significant architectural or business decision was introduced, create an ADR under `docs/Decisions/`.

## Discovery Rule

While implementing a task, if you discover any of the following, do not silently ignore it:

- Undocumented dependencies
- Architecture/documentation inconsistencies
- Dangerous concurrency behavior
- Tenant-isolation weaknesses
- Authorization inconsistencies
- Financial integrity risks
- Missing audit behavior

Report discoveries under:

### Architectural Findings

Separate them into:

- Blocking
- Should fix
- Informational

Do not expand the current task to fix unrelated findings unless they are required to safely complete the requested change.

## Risk Escalation

Treat changes involving any of the following as high or critical risk by default:

- Authentication
- Authorization
- Agency or tenant isolation
- Payments
- Invoices
- Refunds
- Trust or cash accounting
- QuickBooks
- Client access
- Data deletion
- Migrations
- Financial reporting
- Audit history
- External webhooks
- Automated communications
- Shared workflow state

## Core Principle

CaseDesk is a highly interconnected SaaS.

The objective is not merely to make the requested change work. The objective is to make the requested change work without silently breaking another CaseDesk workflow.

Never treat documentation as more authoritative than the actual code. If documentation and code disagree, investigate the code and update the documentation.
