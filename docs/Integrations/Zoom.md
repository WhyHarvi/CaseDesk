---
type: integration
status: active
risk: high
---

# Zoom

## Purpose
Creates and manages Zoom meetings for configured booking/session modes and maps CaseDesk staff to Zoom hosts.

## Authentication Method
Zoom OAuth authorization code/refresh tokens stored encrypted in `AgencyZoomConnection`. OAuth callback state is signed; Zoom webhook validation uses the configured secret token.

## Backend
`backend/src/services/zoomService.js`, `appointmentMeetingService.js`, `backend/src/routes/zoomRoutes.js`, and `backend/src/controllers/zoomController.js`.

## Routes and Webhooks
The Zoom router exposes status/connect/callback/disconnect, host mappings, and webhook handling. Connection maintenance and appointment-meeting workers refresh/retry asynchronously.

## Database Models
`AgencyZoomConnection`, `ZoomHostMapping`, [[Appointment]], and `AppointmentMeetingJob`.

## Features Relying On
[[Appointments and Booking]].

## Failure Implications
Appointments can remain booked while meeting creation/update fails; retryable job state and connection errors surface the mismatch. Non-Zoom meeting modes are separate.

## Environment Variables
`ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`, `ZOOM_REDIRECT_URI`, `ZOOM_WEBHOOK_SECRET_TOKEN`, `MAIL_SETTINGS_ENCRYPTION_KEY`.
