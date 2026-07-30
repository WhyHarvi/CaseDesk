# CaseDesk

Immigration case-management platform.

- **backend/** — Node.js + Express + Prisma API (Supabase Postgres, Auth & Storage)
- **frontend/** — React + Vite + Tailwind web app (staff portal + mobile client portal)

## Local development

```bash
./run-dev.sh
```

Backend runs on http://localhost:5001, frontend on http://localhost:5173.

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

Production startup runs `prisma migrate deploy` before the API starts, so new
appointment and Zoom tables are created before application code uses them.

For the current CHK production deployment, register these exact URLs:

- OAuth redirect:
  `https://casedesk-production.up.railway.app/api/zoom/callback`
- Event subscription:
  `https://casedesk-production.up.railway.app/api/zoom/webhook`

The four `ZOOM_*` variables are backend secrets and belong in the Railway
backend service only. They must not be added to the Vite/Cloudflare frontend
environment.
