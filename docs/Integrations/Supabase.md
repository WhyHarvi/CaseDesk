---
type: integration
status: active
risk: critical
---

# Supabase

## Purpose
Supplies user authentication, object storage, and Postgres realtime subscriptions for chat. Prisma connects to PostgreSQL separately through its database URL.

## Authentication Method
Frontend users authenticate with the public anon key. The backend verifies access tokens against Supabase JWKS and uses the service-role key only for administrative Auth and Storage REST calls.

## Backend
`backend/src/services/supabaseAuth.js`, `supabaseStorage.js`, `documentStorage.js`, attachment-storage services, and auth middleware/controllers.

## Routes and Data
Used by auth/onboarding/account routes and document/form/chat/profile/support controllers. Relevant models include [[User]], [[ClientDocument]], [[CaseForm]], and chat attachment models.

## Features Relying On
[[Authentication]], [[Documents]], [[Forms and Questionnaires]], [[Client Portal]], [[Internal Chat]], [[Communications]], [[Users and Onboarding]], and [[Support and AI Assistant]].

## Failure Implications
Auth failure blocks sessions/provisioning; Storage failure leaves file metadata/object operations incomplete; Realtime failure degrades live chat but persisted messages remain accessible through the API.

## Environment Variables
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DOCUMENT_BUCKET`, `SUPABASE_AVATAR_BUCKET`, `SUPABASE_VOICE_TUNE_BUCKET`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
