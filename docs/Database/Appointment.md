---
type: database-model
status: active
risk: high
---

# Appointment

## Purpose
Calendar event for a client, case, lead, or guest, including public management, meeting, reminder, assignment, recurrence, and attendance state.

## Important Fields
Tenant and optional client/case/lead/session links, subject/time/location/timezone, meeting provider IDs/sync state, unique manage token/reference, reminder and confirmation state, assignment, recurrence, status, and idempotency key.

## Relationships
Belongs to [[Agency]] and optional [[Client]], [[Case]], [[Lead]], session type, and user actors; owns events, deliveries, holds, approvals, calendar sync, meetings, and advice.

## Features and Services
[[Appointments and Booking]], [[Leads]], [[Notifications]], [[Zoom]], and [[Microsoft 365]]. Modified by appointment/booking/meeting/calendar/no-show/attendance services.

## Deletion and Rules
Client/case deletion cascades, lead deletion sets null, actor deletion sets null. Availability, timezone, idempotency, manage-token secrecy, and external sync state are sensitive.
