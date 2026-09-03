---
type: system
status: active
risk: critical
---

# Architecture

CaseDesk is a two-process SaaS application: a Vite/React single-page app calls an Express JSON API, which uses Prisma against PostgreSQL. Supabase supplies user authentication, object storage, and realtime chat subscriptions. The Express process also runs polling workers for scheduled and integration work.

## Runtime Layers

- Frontend entry and routing: `frontend/src/main.jsx`, `frontend/src/routes/AppRoutes.jsx`, and [[Frontend-Architecture]].
- HTTP/API composition: `backend/src/server.js` and [[API-Architecture]].
- Domain code: `backend/src/controllers/`, `backend/src/services/`, and `backend/src/modules/`.
- Persistence: `backend/prisma/schema.prisma` and [[Database-Overview]].
- Security: [[Authentication]], [[Authorization]], and [[Multi-Tenancy]].
- External systems: [[Supabase]], [[QuickBooks Online]], [[Twilio]], [[Microsoft 365]], [[SMTP and IMAP]], [[Zoom]], [[Ollama]], [[Web Push]], and [[Meta Lead Ads]].

## Cross-Cutting Behavior

`backend/src/server.js` applies request IDs, secure headers, CORS, JSON/form parsing, and cache invalidation. Controllers commonly create [[ActivityLog]] records and domain services enqueue [[Notifications]] or provider work. Worker coordination uses the [[WorkerLease]] table described in [[Database-Overview]].

## Deployment-Sensitive Configuration

The database, frontend/API origins, Supabase credentials, provider OAuth credentials, encryption key, webhook verifier secrets, mail settings, VAPID keys, worker intervals, request-size limits, and proxy trust are environment controlled. Names are documented only in the relevant integration/system notes.

## Change Risk

Critical. Shared middleware, Prisma relations, worker startup, and tenant predicates affect most business capabilities.
