---
type: decision
status: implemented
risk: high
---

# Hybrid Workflow Automation

## Context

Case workflow milestones were manually controlled even though the data model contained a stage trigger. The built-in templates did not configure that trigger, and event-backed milestones such as a signed retainer or recorded decision had no supported automation path. Automatically inferring progress from weak signals such as a file upload would create false case history.

## Decision

Workflow completion is hybrid:

1. Use `Stage` for internal milestones whose completion is represented by an explicit case-stage transition.
2. Use `Event` only for a closed vocabulary of durable, case-scoped activity evidence.
3. Keep judgment-based and externally observed milestones manual.

The built-in retainer milestone is a compound rule: it completes only after both a signed-retainer event and confirmed-payment evidence exist. Selecting a payment method, submitting unverified payment proof, or opening a QuickBooks checkout is not payment evidence.

Automation atomically claims only `Pending` steps and records `workflow_step.auto_completed`. It never reverses completion when a stage moves backward. Staff retain the ability to complete and reopen milestones manually.

## Existing Cases and Templates

Trigger metadata is copied to case steps and preserved when a case workflow is edited or reapplied. When built-in or custom template trigger metadata changes, linked case steps are synchronized by template-step identity, with a title match used only to reconnect steps after template-step replacement. Only newly changed triggers are reconciled against historical activity/stage evidence; ordinary case reads do not repeatedly override a manual reopen.

## Consequences

- Reliable workflow progress advances without duplicate completion or audit rows.
- External milestones remain explicit staff decisions unless CaseDesk gains authoritative evidence for them later.
- Adding a new event requires adding it to the backend closed vocabulary, activity mapping, settings labels, tests, and [[Workflows and Tasks]].
- QuickBooks synchronization records `invoice.paid` only when an outstanding case invoice crosses to a zero balance.

## Related Features

- [[Workflows and Tasks]]
- [[Cases]]
- [[Billing and Payments]]
- [[Agreements and Correspondence]]
- [[Forms and Questionnaires]]
- [[Documents]]
