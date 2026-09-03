---
type: database-model
status: active
risk: high
---

# OnboardingRequest

## Purpose
Tracks pre-activation workspace/account invitation and setup.

## Important Fields
Unique `email` and `authUserId`, identity/workspace input, `status`, agency/user links, terms acceptance, invite/completion/expiry dates, and failure code.

## Relationships
Optionally belongs to [[Agency]] and [[User]], cascading with either parent.

## Features and Services
[[Users and Onboarding]] and [[Authentication]] through onboarding routes/controller and `backend/src/middleware/onboardingAuth.js`.

## Deletion and Rules
Only invited/pending unexpired requests can continue; completed requests reject replay. Provisioning must coordinate Supabase identity, agency, user, and membership creation.
