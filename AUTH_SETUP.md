# CaseDesk authentication setup

CaseDesk uses Supabase Auth for sign-in, Express for trusted application identity and authorization, Prisma for normal server-side data access, and PostgreSQL RLS as a second tenant boundary.

## Environment

Backend (`backend/.env`):

```env
SUPABASE_URL=https://PROJECT_REF.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Frontend (`frontend/.env`):

```env
VITE_SUPABASE_URL=https://PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_API_URL=http://localhost:5001/api
```

The service-role key is server-only. Never prefix it with `VITE_` or include it in the frontend environment.

Set `FRONTEND_URL` to the public frontend origin. In Supabase Auth URL configuration, add these exact redirect URLs:

```text
https://YOUR_CASEDESK_DOMAIN/auth/accept-invite
https://YOUR_CASEDESK_DOMAIN/auth/reset-password
```

Customize the Supabase **Invite user** and **Reset password** email templates with CaseDesk branding. Keep the configured Supabase OTP/invitation lifetime aligned with the application invitation lifetime (24 hours by default).

## Apply and run

```sh
cd backend
npx prisma migrate deploy
npx prisma generate
npm test

cd ../frontend
npm run build
```

Start both applications from the project root with `./run-dev.sh`.

If the original combined authentication migration previously failed with PostgreSQL error `55P04`, mark that failed attempt as rolled back once before deploying the split migrations:

```sh
cd backend
npx prisma migrate resolve --rolled-back 20260714120000_add_auth_authorization_foundation
npx prisma migrate deploy
```

## Demo accounts

Set a local-only password of at least 10 characters, then seed:

```sh
cd backend
DEMO_PASSWORD='choose-a-local-password' npm run db:seed
```

The seed creates these confirmed Supabase Auth users and their application memberships:

- `admin@demo.casedesk` — admin
- `consultant1@demo.casedesk` — consultant
- `consultant2@demo.casedesk` — consultant
- `client1@demo.casedesk` — client portal
- `client2@demo.casedesk` — client portal

All use `DEMO_PASSWORD` unless a per-account variable such as `DEMO_ADMIN_PASSWORD` is provided. Do not use demo passwords in production.

## Existing production admin

For an existing installation, apply the migration first. Create or locate the admin in Supabase Auth, then link that UUID to the matching application user in a controlled SQL session:

```sql
update public.users
set auth_user_id = 'SUPABASE-AUTH-USER-UUID', status = 'active'
where email = 'admin@example.com';

update public.agency_members
set role = 'admin', is_active = true
where user_id = (select id from public.users where email = 'admin@example.com');
```

New agencies register at `/register`. The public `POST /api/onboarding/register-agency` route is rate limited, returns a non-enumerating response for existing accounts, and sends a Supabase invitation without collecting a password. The invited owner completes the basic template identity fields at `/auth/accept-invite` before the agency and admin account become active.

Agency admins invite consultants from the Consultants page. Consultants use the same `/auth/accept-invite` callback and the same `/login` page as admins and clients. Roles are resolved from the verified token and active agency membership; users never choose a role on the login screen.

## Workload formula

The initial workload percentage is `active assigned cases / maximum active cases × 100`, rounded and capped at 100. Pending tasks, overdue tasks, and documents awaiting review are returned as supporting counts but do not yet change the percentage.

## Security notes

- Express derives user ID, agency, and role only from a verified Supabase token and an active database membership.
- Client-provided `agencyId`, `role`, and `userId` are never identity inputs.
- Consultant client/case access is limited to direct assignments and active case assignments.
- Client portal APIs resolve the CRM client through `client_users` and never return internal notes or internal documents.
- Activity logs have no authenticated RLS update/delete policy, and their REST routes are read-only.
- Prisma normally connects with the trusted backend database role; every backend tenant query must therefore remain agency-scoped even though RLS protects direct Supabase access.
