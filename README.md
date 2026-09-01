# CaseDesk

CaseDesk is an immigration case-management platform built for CHK Immigration
Services — a single system for running an immigration practice end to end:
leads, cases, appointments, documents, billing, and client communication, all
in one place.

## What it does

- **Leads & intake** — capture, qualify, and convert prospective clients,
  including bulk import from Case Easy.
- **Case management** — track applications through their full lifecycle
  (stage, status, decisions, document checklists, activity history).
- **Client & case profiles** — a complete record per client and per case,
  including notes, documents, and communication history.
- **Scheduling** — appointment booking with Zoom, in-person, and phone
  session types, plus a public self-serve booking flow.
- **Communications** — a unified inbox spanning internal team chat, secure
  portal messaging, email, and SMS, with an AI assistant (Nova) built in.
- **Calls** — a browser-based softphone (Twilio Voice) with call history and
  routing.
- **Documents** — collection, review, and e-signature workflows.
- **Payments & incentives** — invoicing, payment tracking, QuickBooks Online
  sync, and consultant incentive calculations.
- **Client portal** — a mobile-friendly portal where clients track their
  case, message their team, and manage documents and payments.
- **Team tools** — workload views, follow-up queues, and role-based
  permissions across admin, consultant, and front-desk roles.

## Tech stack

- **Backend** — Node.js, Express, Prisma ORM
- **Frontend** — React, Vite, Tailwind CSS
- **Database, auth & storage** — Supabase (Postgres)
- **Integrations** — Zoom, Twilio (voice & SMS), Microsoft 365 mail,
  QuickBooks Online, Meta Graph API, Ollama (AI)

## Project structure

```
backend/    Express + Prisma API
frontend/   React + Vite web app (staff workspace + client portal)
```

## Local development

Requires Node.js and access to this workspace's Supabase project.

```bash
# Backend — http://localhost:5001
cd backend
npm install
npm run dev

# Frontend — http://localhost:5173
cd frontend
npm install
npm run dev
```

Each package's `.env` is populated from its `.env.example`. The backend test
suite runs with `npm test` from `backend/`.

## Deployment

The backend deploys on Railway; the database, auth, and file storage run on
Supabase. Production startup runs `prisma migrate deploy` before the API
starts, so schema changes apply automatically on deploy.

`DATABASE_URL` should point at Supabase's **transaction-mode** connection
pooler (port `6543`, with `pgbouncer=true`) rather than the session-mode
pooler — the app issues many short-lived concurrent queries per page, which
session mode's much lower connection ceiling isn't built for. `DIRECT_URL`
(used only for migrations) can stay on a direct/session connection.
