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
Template steps are copied into case steps; ordering and status are explicit. Activity events can auto-complete configured milestones, which feed notifications, workload, and incentive timelines.

## Permissions
Requires Tasks case-tab access and case scope. Template management and sensitive mutations are role-restricted.

## Side Effects
Creates/updates case steps, activity, notifications, and possibly incentive progress.

## Change Risk
High because automation consumers interpret step state and milestone completion.

## Tests
`backend/test/workflowMilestoneAutoComplete.test.js` and `followUpWorkflowIntegrity.test.js`.
