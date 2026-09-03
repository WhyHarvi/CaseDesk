---
type: database-model
status: active
risk: critical
---

# Agency

## Purpose
Tenant root and workspace profile/configuration owner.

## Important Fields
`id`, optional unique `slug`, `status`, `onboardingStatus`, `accessStatus`, locale/timezone/currency, contact/legal/signing fields, and avatar metadata.

## Relationships
Parent of [[AgencyMember]], [[User]], [[Client]], [[Case]], provider settings, templates, policies, notifications, and almost every tenant-owned row.

## Features and Services
[[Multi-Tenancy]], [[Users and Onboarding]], [[Authentication]], settings, billing, forms, booking, and all integrations. Modified by onboarding, admin, agency-profile, and developer controllers.

## Deletion and Rules
Most child relations cascade. Status/onboarding/access state is checked by auth middleware; `read_only` must prevent writes. Timezone/currency/settings influence operational behavior.
