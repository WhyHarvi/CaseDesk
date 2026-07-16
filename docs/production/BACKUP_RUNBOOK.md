# Database backup and restore runbook

- Enable managed PostgreSQL point-in-time recovery and daily encrypted backups with at least 30 days retention.
- Test restoration into an isolated project every quarter. Never test restoration over production.
- Before a major migration, confirm the latest backup completed and record its recovery point.
- Restore drill: create isolated database, restore snapshot, run `npx prisma migrate status`, execute backend tests, compare agency/lead/event counts, then destroy the isolated copy under the retention policy.
- Provider secrets are encrypted in the database; the deployment encryption key must be backed up separately in the secret manager. Losing that key makes credentials unrecoverable.
- Record the operator, timestamps, backup identifier, recovery-point objective, and validation results for every drill.

