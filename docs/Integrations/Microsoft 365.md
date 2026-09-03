---
type: integration
status: active
risk: high
---

# Microsoft 365

## Purpose
Connects agency-wide and personal Microsoft mailboxes for outbound/inbound/sent-mail synchronization and mirrors appointments to Outlook calendars.

## Authentication Method
Microsoft identity-platform OAuth 2 authorization code with offline refresh tokens. Access/refresh tokens are encrypted in agency or user mailbox connection rows and refreshed by `microsoftMailboxService.js`.

## Backend
`backend/src/services/microsoftMailboxService.js`, `agencyMailService.js`, `inboundMailSyncService.js`, and `outlookCalendarSyncService.js`.

## Routes
`backend/src/routes/personalMailboxRoutes.js`, mailbox/account settings routes and controllers; calendar operations are nested under appointment routes.

## Database Models
`AgencyMicrosoftMailboxConnection`, `UserMailboxConnection`, `AppointmentCalendarSync`, plus communication conversations/messages.

## Features Relying On
[[Communications]], [[Appointments and Booking]], [[Notifications]], and [[Users and Onboarding]].

## Failure Implications
Outbound email, inbound/sent import, or calendar synchronization retries/fails independently; connection rows record errors and users may receive reconnect notifications.

## Environment Variables
`MS_MAIL_CLIENT_ID`, `MS_MAIL_CLIENT_SECRET`, `MS_MAIL_TENANT_ID`, `MS_MAIL_REDIRECT_URI`, `MAIL_SETTINGS_ENCRYPTION_KEY`, `INBOUND_MAIL_SYNC_MS`, `INBOUND_MAIL_INITIAL_LIMIT`.
