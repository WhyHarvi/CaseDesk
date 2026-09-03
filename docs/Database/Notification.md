---
type: database-model
status: active
risk: high
---

# Notification

## Purpose
User-targeted in-app alert with lifecycle, navigation, deduplication, recurrence, and delivery records.

## Important Fields
Tenant/recipient/actor, type/category/title/body/severity, entity/action/destination metadata, unique dedupe key per tenant-recipient, occurrence timing/count, attention level, and read/dismissed/resolved/expiry timestamps.

## Relationships
Belongs to [[Agency]], recipient [[User]], optional actor, and owns delivery attempts.

## Features and Services
[[Notifications]] and most operational features. Modified by notification service, scheduler, delivery worker, access service, and feature-specific producers.

## Deletion and Rules
Tenant or recipient deletion cascades; actor deletion sets null. Producers must use stable dedupe keys and scheduler resolution must recheck entity state before hiding alerts.
