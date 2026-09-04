---
type: database-model
status: active
risk: high
---

# Client

## Purpose
Agency-scoped CRM person/contact and parent for cases and client work.

## Important Fields
Agency-unique `clientNumber`, display and structured names, UCI, `phone`/`phoneNormalized`, optional `secondaryPhone`/`secondaryPhoneNormalized`, normalized email, identity/address fields, status/archive, QuickBooks sync fields, owner, and creation idempotency key.

## Relationships
Belongs to [[Agency]] and optional owner [[User]]; parent of [[Case]], [[ClientUser]], documents, payments/invoices, communications, appointments, profiles, forms, and imports.

## Features and Services
[[Clients]] and every linked feature. Modified by `clientController.js`, profile sync, duplicate, numbering, Case Easy, lead conversion, booking, and QuickBooks sync services.

## Deletion and Rules
Agency deletion cascades. Client deletion cascades many children, while some relations use `SetNull`; operational code generally archives instead. Email and each normalized phone column have tenant-scoped unique indexes. Application-level intake locking and duplicate checks also prevent cross-column collisions (one client's primary cannot equal another client's secondary), while a database check prevents the two phone slots on one client from being equal.
