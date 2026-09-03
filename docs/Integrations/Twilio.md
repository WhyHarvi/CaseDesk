---
type: integration
status: active
risk: high
---

# Twilio

## Purpose
Provides tenant-configured SMS, browser softphone tokens, inbound/outbound voice, call queues/ringing, status events, recordings, and voice-line assignment.

## Authentication Method
Agency Account SID/Auth Token and optional API key SID/secret are stored per agency; secrets are encrypted. Browser voice uses short-lived Twilio access tokens. Incoming callbacks validate `X-Twilio-Signature` against the resolved agency auth token and exact public callback URL.

## Backend
`backend/src/services/agencyTwilioService.js`, `twilioCallService.js`, `twilioSmsSyncService.js`; Twilio settings/call/webhook controllers.

## Routes and Webhooks
`backend/src/routes/twilioCallRoutes.js`, `callHistoryRoutes.js`, and Twilio paths in `communicationWebhookRoutes.js`.

## Database Models
`AgencyTwilioSettings`, `AgencyTwilioVoiceLine`, `AgencyTwilioVoiceLineAssignee`, `CallSession`, `CallRingDispatch`, `CallEvent`, and communication message/delivery models.

## Features Relying On
[[Communications]], [[Leads]], [[Appointments and Booking]], and [[Follow-Ups and Reminders]].

## Failure Implications
Calls/SMS and delivery reconciliation stop or remain pending; incorrect public origin/signature construction rejects legitimate callbacks. The database history remains the CRM source view.

## Environment Variables
`API_PUBLIC_URL`, `MAIL_SETTINGS_ENCRYPTION_KEY`, `SUPABASE_VOICE_TUNE_BUCKET`.
