---
type: feature
status: active
risk: high
---

# Documents

## Purpose
Stores uploaded client/case files, folders, reusable templates, shared-library files, previews, expiry metadata, and generated PDFs.

## Depends On
- [[Clients]]
- [[Cases]]
- [[Supabase]]
- [[Authorization]]

## Used By
[[Forms and Questionnaires]], [[Agreements and Correspondence]], [[Client Portal]], [[Follow-Ups and Reminders]], and dashboard views.

## Database Models
[[ClientDocument]], `DocumentFolder`, `DocumentTemplate`, `SharedLibraryDocument`, `ExpiringDocumentReminderPolicy`, and `ExpiringDocumentReminderDelivery`.

## Backend
`backend/src/routes/clientDocumentRoutes.js`, `documentTemplateRoutes.js`, `sharedLibraryRoutes.js`; related controllers; `backend/src/services/documentStorage.js`, `pdfCompressionService.js`, `documentProgramCatalog.js`, and upload middleware.

## Frontend
`frontend/src/pages/Documents.jsx`, `frontend/src/components/case-profile/DocumentsWorkspace.jsx`, `frontend/src/components/documents/`, and document settings panels.

## Integrations
[[Supabase]] Storage.

## Business Rules
Uploads are MIME/size limited and case PDFs may be compressed without rasterizing fillable PDFs. Database metadata and storage objects must stay consistent. Visibility and case access determine exposure; expiry reminders are deduplicated.

## Permissions
Requires documents page or case Documents tab; child lookups must preserve case/client assignment scope. Portal downloads are policy-gated.

## Side Effects
Writes object storage and metadata, may create activities and expiry notifications.

## Change Risk
High due to sensitive files, storage cleanup, and client-portal exposure.

## Tests
`backend/test/documentBulkUpload.test.js`, `pdfCompression.test.js`, and `expiringDocumentReminderService.test.js`.
