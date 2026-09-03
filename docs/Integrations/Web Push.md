---
type: integration
status: active
risk: medium
---

# Web Push

## Purpose
Delivers selected [[Notifications]] to browser push subscriptions.

## Authentication Method
Application-server VAPID public/private key pair and subject; browsers register endpoint/key material in `PushSubscription` rows.

## Backend
`backend/src/services/webPushService.js`, `notificationDeliveryService.js`, `backend/src/controllers/pushSubscriptionController.js`, and notification routes.

## Database Models
`PushSubscription`, [[Notification]], and `NotificationDelivery`.

## Features Relying On
[[Notifications]].

## Failure Implications
Push delivery records fail while in-app notifications remain. Permanently invalid subscriptions may be removed.

## Environment Variables
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `VITE_VAPID_PUBLIC_KEY`.
