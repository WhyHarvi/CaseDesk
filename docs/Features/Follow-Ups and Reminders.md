---
type: feature
status: active
risk: medium
---

# Follow-Ups and Reminders

## Purpose
Tracks staff follow-ups and runs automated client reminders for follow-up milestones, document expiry, case tasks, forms, appointments, and configured communication policies.

## Depends On
- [[Cases]]
- [[Clients]]
- [[Communications]]
- [[Notifications]]
- [[Incentives and Workload]]

## Used By
[[Dashboard and Search]], [[Documents]], [[Workflows and Tasks]], and [[Appointments and Booking]].

## Database Models
`FollowUp`, `AutomatedReminderPolicy`, `AutomatedReminderDelivery`, `ExpiringDocumentReminderPolicy`, and `ExpiringDocumentReminderDelivery`.

## Backend
`backend/src/routes/followUpRoutes.js`, `followUpController.js`, `automatedReminderSettingsController.js`, `expiringDocumentReminderController.js`; `followUpClientReminderService.js`, `automatedReminderService.js`, and `expiringDocumentReminderService.js`.

## Frontend
`frontend/src/pages/FollowUps.jsx`, `frontend/src/components/case-profile/RemindersWorkspace.jsx`, and reminder settings panels.

## Integrations
[[SMTP and IMAP]], [[Twilio]], and [[Web Push]] through communications/notifications.

## Business Rules
Status and dates drive due/overdue milestones. Delivery tables and idempotency keys prevent repeats. Policies control cadence and enabled channels.

## Permissions
Requires Follow-Ups or Cases access, plus client/case record scope; policy settings are administrative.

## Side Effects
Queues email/SMS, creates in-app notifications, and updates delivery/status records. Completing a Study Permit case's dedicated "Post-submission follow-up" also credits that case's Post-Submission Follow-Up Completed work milestone, once per incentive cycle; see [[Incentive Expansion Requirements]].

## Change Risk
Medium; mistakes mainly cause missed or duplicate reminders but can affect client trust.

## Tests
`backend/test/followUpEditing.test.js`, `followUpWorkflowIntegrity.test.js`, `automatedReminderService.test.js`, and `expiringDocumentReminderService.test.js`.
