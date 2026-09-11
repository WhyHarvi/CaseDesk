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
[[Multi-Tenancy]], [[Users and Onboarding]], [[Authentication]], [[Commercial Subscription]], settings, client billing, forms, booking, and all integrations. Each customer agency can have one commercial workspace subscription plus feature and limit overrides. Modified by onboarding, admin, agency-profile, and developer controllers.

## Deletion and Rules
Most child relations cascade. Status/onboarding/access state is checked by auth middleware; `read_only` must prevent writes. Timezone/currency/settings influence operational behavior.
