---
type: database-model
status: active
risk: critical
---

# User

## Purpose
Application identity for staff and clients, linked to Supabase Auth.

## Important Fields
`authUserId`, global unique `email`, display/structured names, `role`, `status`, password-change flag, representative/license/signature fields, and avatar data.

## Relationships
Belongs to [[Agency]], has [[AgencyMember]] rows, optional [[ClientUser]], consultant profile, assignments, authored/actor records, mailbox, notifications, chats, and provider-line assignments.

## Features and Services
[[Authentication]], [[Authorization]], [[Users and Onboarding]], [[Cases]], [[Notifications]], forms/signatures, and all assignment-driven features. Auth/admin/user/account controllers modify it.

## Deletion and Rules
Agency deletion cascades users; many historical actor links use `SetNull`, while memberships and portal links cascade. Supabase user lifecycle and database updates must be coordinated.
