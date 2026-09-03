---
type: database-model
status: active
risk: critical
---

# Case

## Purpose
Central immigration matter connecting a client, owner/team, lifecycle, and all case work products.

## Important Fields
`agencyId`, `clientId`, owner, type, stage/status/priority, action/application/study/open dates, idempotency, archive, and soft-delete timestamps.

## Relationships
Belongs to [[Agency]], [[Client]], and optional [[User]]; parent of assignments, profiles, [[ClientDocument]], [[CaseForm]], workflows, [[Appointment]], [[CommunicationConversation]], [[CaseInvoice]], [[CasePaymentSchedule]], and more.

## Features and Services
[[Cases]] and nearly all case workspaces. Case controllers/services, lead conversion, booking, Case Easy, notifications, billing, and incentives modify/read it.

## Deletion and Rules
Client/agency deletion cascades a deep graph. Operational deletion uses `deletedAt`; archival is separate. Access must include both agency and assignment/client predicates. Stage changes should retain `CaseStageHistory`.
