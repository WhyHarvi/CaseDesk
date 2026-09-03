---
type: database-model
status: active
risk: high
---

# CommunicationConversation

## Purpose
Thread aggregate for client/case email, SMS, and portal communication.

## Important Fields
Tenant/client/optional case, channel/provider/thread ID, subject, assignment, state/priority/tags, unread/read timing, inbound/outbound timestamps, SLA due dates, archive/legal-hold/soft-delete, and actors.

## Relationships
Belongs to [[Agency]], [[Client]], optional [[Case]], creator/assignee/deleter; owns communication messages.

## Features and Services
[[Communications]], [[Client Portal]], [[Notifications]], [[Twilio]], [[Microsoft 365]], and [[SMTP and IMAP]]. Modified by communication controllers, inbound sync, outbox, SLA, automation, and maintenance services.

## Deletion and Rules
Client/case deletion cascades; creator deletion is restricted, other actors set null. Legal hold and retention policy must be respected; case-linked access overrides broad client access.
