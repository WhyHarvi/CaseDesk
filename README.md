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

## Zoom appointment setup

CaseDesk uses one Zoom organization per workspace and maps each scheduling
consultant to a distinct Zoom user. Two consultants mapped to two different
Zoom users can host two appointments at the same time.

1. In the Zoom App Marketplace, create an admin-managed General OAuth app.
2. Add the backend callback as an exact OAuth redirect URL:
   `https://YOUR-BACKEND-DOMAIN/api/zoom/callback`.
3. On **Scopes → Add Scopes**, grant only the API methods CaseDesk uses:
   **Get a user**, **List users**, **Create a meeting**, **Update a meeting**,
   and **Delete a meeting**. In Zoom's granular-scope labels these correspond
   to `user:read:user:admin`, `user:read:list_users:admin`,
   `meeting:write:meeting:admin`, `meeting:update:meeting:admin`, and
   `meeting:delete:meeting:admin` (the legacy equivalents are
   `user:read:admin` and `meeting:write:admin`).
4. Enable event subscriptions at
   `https://YOUR-BACKEND-DOMAIN/api/zoom/webhook` for `meeting.updated`,
   and `meeting.deleted`. Configure Zoom's **Deauthorization Notification
   Endpoint** to the same URL so `app_deauthorized` is delivered when an
   administrator removes the app.
5. Set `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`, `ZOOM_REDIRECT_URI`, and
   `ZOOM_WEBHOOK_SECRET_TOKEN` in the backend production environment. Keep
   the existing 32-byte `MAIL_SETTINGS_ENCRYPTION_KEY`; CaseDesk uses it to
   encrypt Zoom access and refresh tokens. The webhook secret is Zoom's
   Event Subscriptions secret token, not the OAuth client secret.
6. Deploy the backend, open **Settings → Scheduling**, connect Zoom, and map
   every participating consultant to a different active Zoom user.
7. Enable Zoom globally and for the required session types, then save
   scheduling settings.

CaseDesk renews inactive Zoom connections every 30 days so Zoom's 90-day
refresh-token lifetime does not unexpectedly disable a quiet workspace. If
Zoom rejects renewal, CaseDesk disables new Zoom bookings and creates a
critical administrator notification asking for reconnection.

For the current CHK production deployment, register these exact URLs:

- OAuth redirect:
  `https://casedesk-production.up.railway.app/api/zoom/callback`
- Event subscription:
  `https://casedesk-production.up.railway.app/api/zoom/webhook`

The four `ZOOM_*` variables are backend secrets and belong in the Railway
backend service only. They must not be added to the Vite/Cloudflare frontend
environment.
