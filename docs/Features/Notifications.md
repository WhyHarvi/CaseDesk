---
type: feature
status: active
risk: high
---

# Notifications

## Purpose
Creates in-app notifications and preferences, resolves/deduplicates scheduled events, and delivers supported notices by email and browser push.

## Depends On
- [[Users and Onboarding]]
- [[Multi-Tenancy]]
- [[Web Push]]

## Used By
[[Cases]], [[Leads]], [[Appointments and Booking]], [[Communications]], [[Billing and Payments]], [[Follow-Ups and Reminders]], and [[Incentives and Workload]].

## Database Models
[[Notification]], `NotificationPreference`, `NotificationDelivery`, and `PushSubscription`.

## Backend
`backend/src/routes/notificationRoutes.js`, `notificationController.js`, `pushSubscriptionController.js`, `notificationService.js`, `notificationAccessService.js`, `notificationScheduler.js`, `notificationDeliveryService.js`, and `webPushService.js`.

## Frontend
`frontend/src/components/notifications/`, `frontend/src/api/notificationApi.js`, and `frontend/src/services/notificationPolling.js`.

## Integrations
[[Web Push]] and [[SMTP and IMAP]].

## Business Rules
Category/type preferences select recipients/channels. Dedupe keys and scheduled timestamps prevent repeated alerts. The scheduler rechecks entity state and resolves stale notifications; worker leases reduce duplicate schedulers.

## Permissions
Users can see/update only their tenant-scoped notifications/preferences/subscriptions. Scheduler jobs compute eligible staff from assignments and roles.

## Side Effects
Creates delivery attempts, sends provider messages, updates read/resolved state, and removes invalid push subscriptions.

## Change Risk
High because this fans out from most domains and can flood or miss recipients.

## Tests
`backend/test/notificationsBackend.test.js`, `notificationPolling.test.js`, `notificationSchedulerBatching.test.js`, and `webPush.test.js`.
