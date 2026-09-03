---
type: feature
status: active
risk: high
---

# Case Information

## Purpose
Provides structured, section-based immigration facts shared by cases, clients, applicants, questionnaires, and government-form autofill.

## Depends On
- [[Cases]]
- [[Clients]]
- [[Forms and Questionnaires]]

## Used By
[[Forms and Questionnaires]], [[Client Portal]], and case profile completion/status UI.

## Database Models
`ClientInformationProfile`, `CaseInformationProfile`, `CaseInformationSectionState`, `ImmigrationProfile`, and [[Case]].

## Backend
`backend/src/modules/case-information/`, `backend/src/controllers/caseInformationWorkspaceController.js`, `caseInformationMutationController.js`, and services named `caseInformation*`, `formDataSourceRegistry.js`, and `formFieldMappingService.js`.

## Frontend
`frontend/src/api/caseInformationApi.js`, `frontend/src/components/case-profile/ProfileCollectionQuestionnaire.jsx`, `QuestionnaireCatalog.jsx`, and `formFieldMappings/`.

## Integrations
None directly.

## Business Rules
The catalog resolves required sections by case type. Mutations synchronize canonical profile data and section completion. A background drift detector finds data that no longer agrees with expected projections.

## Permissions
Requires case access and relevant case tabs; portal questionnaire actions use portal policy.

## Side Effects
Changes completion state, form-fill sources, and potentially client/applicant profile data.

## Change Risk
High because field mappings and ownership rules can silently alter generated government forms.

## Tests
`backend/test/caseInformationCatalog.test.js`, `caseInformationResolver.test.js`, `caseInformationCompletion.test.js`, `caseInformationWorkspace.test.js`, `caseInformationVisibility.test.js`, and `applicantFactCatalogSectionSync.test.js`.
