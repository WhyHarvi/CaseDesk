---
type: feature
status: active
risk: high
---

# Case Easy Import

## Purpose
Imports legacy Case Easy contact/case workbooks and financial/status reports, maps source statuses, previews/reviews rows, and converts supported records into native CaseDesk clients/cases.

## Depends On
- [[Clients]]
- [[Cases]]
- [[Billing and Payments]]
- [[Multi-Tenancy]]

## Used By
Historical ledger/report cards and migration workflows.

## Database Models
`CaseEasyImportContact`, `CaseEasyImportCase`, and `CaseEasyImportReportRow`, plus converted [[Client]], [[Case]], and financial records.

## Backend
`backend/src/routes/caseEasyImportRoutes.js`, `backend/src/controllers/caseEasyImportController.js`, Case Easy services under `backend/src/services/`, upload middleware, and import/backfill scripts under `backend/scripts/`.

## Frontend
`frontend/src/pages/CaseEasyImport.jsx`, `frontend/src/components/case-easy/`, client/case historical ledger cards, and `frontend/src/api/caseEasyImportApi.js`.

## Integrations
Case Easy is file-based; no live provider API is present.

## Business Rules
Workbook headers determine file classification. Source identifiers and statuses are preserved; conversion is reviewable/idempotent and may retain multiple legacy assignees as informational IDs. Report rows link to native records where possible.

## Permissions
Requires the Case Easy Import page; staff role and agency scoping apply. Uploads restrict file type, count, and size.

## Side Effects
Bulk creates/links clients, cases, assignments, and historical financial/report records.

## Change Risk
High because bulk mapping errors can produce widespread irreversible business-data mistakes.

## Tests
`backend/test/caseEasyImport.test.js`, `caseEasyReports.test.js`, `caseEasySearch.test.js`, and `caseEasyStatusMapping.test.js`.
