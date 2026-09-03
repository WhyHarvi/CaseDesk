---
type: database-model
status: active
risk: high
---

# ActivityLog

## Purpose
Tenant audit/timeline record for user and domain actions.

## Important Fields
Tenant, optional actor/client/case, action, details, entity type/ID, JSON metadata, and creation time.

## Relationships
Belongs to [[Agency]]; optional [[User]], [[Client]], and [[Case]] links use `SetNull` so history survives parent deletion.

## Features and Services
[[Cases]], [[Clients]], [[Billing and Payments]], [[Communications]], settings, and many controllers. Read through activity-log routes/controller.

## Deletion and Rules
Agency deletion cascades. Action strings and metadata are consumed by presentation, milestones, and incentives, so renaming event types can be behaviorally significant.
