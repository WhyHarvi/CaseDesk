---
type: feature
status: active
risk: medium
---

# Agreements and Correspondence

## Purpose
Creates editable, versioned written documents and templates for retainers, agreements, letters, and correspondence, with export and public signing flows.

## Depends On
- [[Cases]]
- [[Clients]]
- [[Documents]]
- [[Billing and Payments]]

## Used By
[[Leads]], [[Client Portal]], and case Agreements & Letters workspaces.

## Database Models
`WrittenDocument`, `WrittenDocumentVersion`, `CorrespondenceTemplate`, `CorrespondenceTemplateVersion`, [[ClientDocument]], and lead retainer fields/models.

## Backend
`backend/src/routes/writtenDocumentRoutes.js`, `correspondenceRoutes.js`; `writtenDocumentController.js`, `correspondenceController.js`, `publicRetainerController.js`; template, notification, and PDF services.

## Frontend
`frontend/src/pages/DocumentComposer.jsx`, `frontend/src/components/case-profile/AgreementsLettersWorkspace.jsx`, `RetainerStatusCard.jsx`, `frontend/src/pages/PublicRetainerSignPage.jsx`, and `frontend/src/utils/writtenDocumentExport.js`.

## Integrations
[[Supabase]] storage and [[SMTP and IMAP]] for notifications.

## Business Rules
Documents preserve versions and distinguish case/client ownership and document kind. Public retainer signing uses a manage token and feeds lead commercial state. Export content is sanitized/rendered before download.

## Permissions
Staff need Documents or Agreements & Letters access plus record scope. Public signing is token-scoped.

## Side Effects
Creates versions and files, sends notices, updates retainer state, and records activity.

## Change Risk
Medium to high where signatures, public tokens, or billing terms are involved.

## Tests
`backend/test/leadRetainer.test.js` and written-document behavior covered by feature regression tests.
