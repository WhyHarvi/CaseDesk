---
type: database-model
status: active
risk: critical
---

# PortalAccessPolicy

## Purpose
Stores default, client, or case-scoped allow/deny policy for individual client-portal capabilities.

## Important Fields
`agencyId`, scope/status, capability key, optional client-user/case references, actor/reason, and timestamps; schema constraints/indexes support effective-policy lookup.

## Relationships
Belongs to [[Agency]] and can target [[ClientUser]] and [[Case]].

## Features and Services
[[Client Portal]] and [[Authorization]] via `clientPortalPolicyService.js`, `clientPortalPolicyController.js`, and middleware.

## Deletion and Rules
Policy resolution combines scope layers; suspension/deny must win as implemented. Resource-to-case resolution must happen before applying case policy.
