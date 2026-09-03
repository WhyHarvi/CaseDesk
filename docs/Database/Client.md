---
type: database-model
status: active
risk: high
---

# Client

## Purpose
Agency-scoped CRM person/contact and parent for cases and client work.

## Important Fields
Agency-unique `clientNumber`, display and structured names, UCI, normalized phone/email, identity/address fields, status/archive, QuickBooks sync fields, owner, and creation idempotency key.

## Relationships
Belongs to [[Agency]] and optional owner [[User]]; parent of [[Case]], [[ClientUser]], documents, payments/invoices, communications, appointments, profiles, forms, and imports.

## Features and Services
[[Clients]] and every linked feature. Modified by `clientController.js`, profile sync, duplicate, numbering, Case Easy, lead conversion, booking, and QuickBooks sync services.

## Deletion and Rules
Agency deletion cascades. Client deletion cascades many children, while some relations use `SetNull`; operational code generally archives instead. Email/phone normalization uniqueness is tenant-scoped.
