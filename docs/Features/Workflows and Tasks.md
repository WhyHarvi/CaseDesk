---
type: feature
status: active
risk: high
---

# Workflows and Tasks

## Purpose
Defines reusable workflow templates and materializes ordered case steps with owner, due date, priority, completion state, and milestone behavior.

## Depends On
- [[Cases]]
- [[Users and Onboarding]]
- [[Notifications]]

## Used By
[[Follow-Ups and Reminders]], [[Incentives and Workload]], and case progress views.

## Database Models
`WorkflowTemplate`, `WorkflowTemplateStep`, and `CaseWorkflowStep`.

## Backend
`backend/src/routes/workflowTemplateRoutes.js`, `backend/src/controllers/workflowTemplateController.js`, `caseWorkflowController.js`, and `backend/src/services/workflowService.js`.

## Frontend
`frontend/src/components/case-profile/TasksWorkspace.jsx`, `WorkflowEditorOverlay.jsx`, `WorkflowTimeline.jsx`, and `workflowDrafts.js`; workflow settings appear in Settings.

## Integrations
None directly.

## Business Rules
Template steps are copied into case steps; ordering and status are explicit. Milestones use a hybrid completion model:

- `Manual` milestones remain staff-controlled for judgment-based work and external events that CaseDesk cannot independently verify.
- `Stage` milestones complete only when the case advances through their configured CaseDesk stage. Moving a case backward never reopens them.
- `Event` milestones complete only from durable, case-scoped activity evidence. Supported events are signed retainer, confirmed payment, signed-retainer-plus-confirmed-payment, questionnaire submission, case-form signature/finalization, client-document finalization, application submission, recorded decision, and case closure.

Built-in workflows complete the retainer milestone only after both the signature and initial payment have durable evidence. Questionnaire, submission, decision, and closure milestones use individual event rules; internal document/form preparation milestones use stage rules. IRCC/ESDC correspondence, biometrics, medicals, tests, invitations, and other externally observed outcomes stay manual unless staff explicitly changes the case stage or configures a supported event on a custom template.

Automation is one-way and idempotent: it only claims a `Pending` step, writes `completedAt`, and records `workflow_step.auto_completed`. Staff can still complete or reopen any step manually. A manual reopen is not immediately undone on the next case read. When a trigger is newly added to an already-assigned workflow, CaseDesk reconciles that changed step once against durable case activity/stage history.

QuickBooks invoice synchronization emits `invoice.paid` only when a CaseDesk case invoice crosses from an outstanding balance to zero, so payment-driven workflow rules do not fire from a checkout selection, pending proof, or duplicate webhook.

## Permissions
Requires Tasks case-tab access and case scope. Template management and sensitive mutations are role-restricted.

## Side Effects
Creates/updates case steps, activity, notifications, and possibly incentive progress.

## Change Risk
High because automation consumers interpret step state and milestone completion.

## Tests
`backend/test/workflowMilestoneAutoComplete.test.js` and `followUpWorkflowIntegrity.test.js`.
