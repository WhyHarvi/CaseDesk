---
type: feature
status: active
risk: high
---

# Forms and Questionnaires

## Purpose
Manages agency form templates and versions, case copies, field schemas/values, client requests, review comments, signatures, PDF extraction/fill/render, and structured questionnaires.

## Depends On
- [[Cases]]
- [[Case Information]]
- [[Documents]]
- [[Client Portal]]

## Used By
Government application workflows, applicants, document generation, and case completion.

## Database Models
[[CaseForm]], `CaseFormVersion`, `CaseFormFieldValue`, `CaseFormClientRequest`, `CaseFormSignatureRequest`, `CaseFormReviewComment`, `CaseFormAuditEvent`, `AgencyFormTemplate`, `AgencyFormTemplateVersion`, `FormTemplateFieldSchema`, `FormPermission`, and `QuestionnaireAssignment`.

## Backend
`backend/src/routes/caseFormRoutes.js`, `agencyFormTemplateRoutes.js`; case-form, signature, render, field, government settings, and questionnaire controllers; form/PDF services under `backend/src/services/`.

## Frontend
`frontend/src/components/case-profile/CaseFormsWorkspace.jsx`, `FormFieldChecklistOverlay.jsx`, `FormFieldMappingOverlay.jsx`, `QuestionnaireCatalog.jsx`, and portal questionnaire/form pages.

## Integrations
[[Supabase]] Storage.

## Business Rules
Case forms are versioned copies with source and copy type. Field ownership/fillability and status control staff/client editing. Mappings draw from structured case/client/applicant facts. Signature flows and rendered PDFs preserve audit events.

## Permissions
Staff need the Forms case tab and case access. `formPermissions.js` and portal policy restrict assigned, client-fillable, review, and signature actions.

## Side Effects
Creates versions/audits, stores rendered files, requests client action, and can update field/completion state.

## Change Risk
High because mapping or version changes can corrupt regulated form output.

## Tests
`backend/test/caseFormAssignedAccess.test.js`, `caseFormSignatureMigration.test.js`, `imm5476Workflow.test.js`, `clientFormSignatureNotice.test.js`, and case-information suites.
