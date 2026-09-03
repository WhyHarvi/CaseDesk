---
type: database-model
status: active
risk: high
---

# ClientDocument

## Purpose
Metadata for an uploaded/generated client or case document whose bytes live in [[Supabase]] Storage.

## Important Fields
Tenant/client/case ownership, storage key, original/display names, MIME/size, status/visibility, category/expiry, uploader/reviewer, and timestamps.

## Relationships
Belongs to [[Agency]], [[Client]], optional [[Case]], and user actors; may be referenced by document/portal workflows.

## Features and Services
[[Documents]], [[Client Portal]], [[Forms and Questionnaires]], and reminders. Modified by document controllers, `documentStorage.js`, compression, and expiry services.

## Deletion and Rules
Database deletion does not by itself guarantee object deletion; controllers/services must coordinate both. Case/client visibility and portal policy are security-sensitive.
