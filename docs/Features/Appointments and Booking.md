---
type: feature
status: active
risk: high
---

# Appointments and Booking

## Purpose
Manages the shared calendar, appointment profiles, session types, public booking/rescheduling/cancellation, availability, staff assignment, blocks, waitlists, payment holds, meeting creation, attendance, no-shows, and pre-consultation intake.

## Depends On
- [[Clients]]
- [[Leads]]
- [[Authorization]]
- [[Notifications]]

## Used By
[[Cases]], [[Client Portal]], [[Dashboard and Search]], and lead consultation workflows.

## Database Models
[[Appointment]], `AppointmentEvent`, `AppointmentCalendarSync`, `BookingSettings`, `BookingSessionType`, `SchedulingStaffPreference`, `BookingSessionTypeStaff`, `SchedulingBlock`, `BookingWaitlistEntry`, `BookingSlotHold`, `BookingPaymentHold`, `BookingVerificationCode`, `BookingMessageDelivery`, and `AppointmentMeetingJob`.

## Backend
`appointmentRoutes.js`, `bookingRoutes.js`, `publicBookingRoutes.js`, `preConsultationIntakeRoutes.js`; appointment/booking controllers; availability, meeting, notification, waitlist, payment-hold, no-show, attendance, advice, and scheduling services.

## Frontend
`frontend/src/pages/CalendarPage.jsx`, `PublicBookingPage.jsx`, `ManageBookingPage.jsx`, appointment/booking components, and `frontend/src/api/bookingApi.js`.

## Integrations
[[Zoom]], [[Microsoft 365]], [[SMTP and IMAP]], [[Twilio]], and Jitsi Meet fallback links.

## Business Rules
Availability combines agency/session/staff settings, blocks, existing appointments, buffers, notice, holds, and timezone. Public actions use tokens/codes. Meeting and calendar sync are asynchronous and retryable; no-show and reminder workers update outcomes.

When any staff member with permission saves appointment notes after a scheduled appointment has started, the appointment is automatically marked attended. Confirmed post-consultation advice provides the same signal for its permitted staff. Terminal and future appointments are never changed by these signals.

## Permissions
Staff calendar is workspace-visible, while mutations remain role and case scoped. Public booking resolves agency/session through tokens and rate limits.

## Side Effects
Creates leads/clients, holds, meetings, calendar events, notifications/messages, appointment events, and possibly refund fee estimates.

## Change Risk
High because timezones, concurrency, public access, payments, and multiple providers intersect.

## Tests
`backend/test/schedulingOperations.test.js`, `schedulingBlocks.test.js`, `bookingMeetingModes.test.js`, `bookingPaymentHoldVoidGrace.test.js`, `appointmentProfile.test.js`, `appointmentAdvice.test.js`, `appointmentSubjectRequirement.test.js`, and `calendarContactRegression.test.js`.
