# CaseDesk production deployment

1. Configure all values in `backend/.env.example` through the deployment secret store. Never commit real values.
2. Use pooled `DATABASE_URL` for the application and direct `DIRECT_URL` for migrations.
3. Run `npm ci`, `npx prisma migrate deploy`, `npx prisma generate`, `npm test`, and the frontend production build before release.
4. Run one backend worker process per application replica; event claiming is atomic and stale locks recover after five minutes.
5. Route HTTPS through a trusted proxy and set `TRUST_PROXY_HOPS` to the exact proxy count.
6. Readiness probe: `GET /api/health`. Liveness probe: `GET /api/health/live`.
7. Alert on readiness failures, any sustained `FAILED` intake count, oldest pending age above 60 seconds, or repeated structured `error` logs.
8. Roll back application code normally. Never reverse a production migration destructively; use a forward corrective migration.

