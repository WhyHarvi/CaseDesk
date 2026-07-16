# CaseDesk production deployment

1. Configure all values in `backend/.env.example` through the deployment secret store. Never commit real values.
2. Use pooled `DATABASE_URL` for the application and direct `DIRECT_URL` for migrations.
3. Run `npm ci`, `npx prisma migrate deploy`, `npx prisma generate`, `npm test`, and the frontend production build before release.
4. Run one backend worker process per application replica; event claiming is atomic and stale locks recover after five minutes.
5. Route HTTPS through a trusted proxy and set `TRUST_PROXY_HOPS` to the exact proxy count.
6. Readiness probe: `GET /api/health`. Liveness probe: `GET /api/health/live`.
7. Alert on readiness failures, any sustained `FAILED` intake count, oldest pending age above 60 seconds, or repeated structured `error` logs.
8. Roll back application code normally. Never reverse a production migration destructively; use a forward corrective migration.

## Private file storage

Case files and consultant avatars are stored in private Supabase Storage buckets. The backend is the only Storage client and must use the server-only service-role key; never expose that key to Vite or a browser.

1. Set `SUPABASE_DOCUMENT_BUCKET=case-files` and `SUPABASE_AVATAR_BUCKET=profile-avatars`.
2. Run `npm run storage:configure` to enforce private access, the application MIME allowlists, and the 25 MB / 5 MB limits.
3. Before the first Storage-backed deployment, run `npm run storage:migrate-local:dry-run`, then `npm run storage:migrate-local` to copy existing local files. The migration is idempotent and does not delete the local fallback copy.
4. Verify several document, form, attachment, agreement, and avatar downloads through authenticated application routes.
5. Back up Storage objects and the database together because database records contain the corresponding object keys.
