---
type: database-model
status: active
risk: high
---

# Lead

## Purpose
Primary prospect record and aggregate root for pipeline, ownership, commercial/consultation state, intake provenance, and conversion.

## Important Fields
Agency lead number, normalized contact data, source/campaign, status/stage/segment/priority/temperature, assignee, SLA/next-action dates, duplicate/commercial fields, and links to early/converted client/case.

## Relationships
Belongs to [[Agency]] and source/owner records; has activities, follow-ups, consultations, routing/history, messages, duplicate candidates, appointments, and optional [[Client]]/[[Case]] links.

## Features and Services
[[Leads]], [[Appointments and Booking]], [[Communications]], and [[Notifications]]. Modified throughout `backend/src/modules/leads/`.

## Deletion and Rules
Tenant deletion cascades. Provider/public ingestion relies on event and idempotency uniqueness. Conversion must not duplicate the linked client/case and retains provenance.
