---
type: database-model
status: active
risk: critical
---

# ClientUser

## Purpose
Links an authenticated [[User]] with client role to the [[Client]] whose portal data they may access.

## Important Fields
`agencyId`, `clientId`, `userId`, relationship, and primary flag; compound unique on tenant/client/user.

## Relationships
Belongs to [[Agency]], [[Client]], and [[User]] with cascade deletion.

## Features and Services
[[Client Portal]], [[Authorization]], and [[Authentication]]. Used by portal controllers, client-portal policy middleware, and case/client access predicates.

## Deletion and Rules
Removing it immediately removes the portal identity's client ownership path. Every lookup must include the authenticated agency.
