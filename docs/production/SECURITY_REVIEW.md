# Lead platform security review

- Tenant scope comes only from verified membership or an unguessable stored connection token; request bodies cannot choose an agency.
- Lead and integration tables use PostgreSQL RLS. Provider credentials are encrypted at rest and omitted from API responses and logs.
- Meta/WhatsApp signatures, Google lead keys, CaseDesk HMAC timestamps, event IDs, and database idempotency protect webhook ingestion.
- Durable hashed rate-limit buckets work across replicas without storing raw IP addresses.
- Security headers, bounded JSON/file sizes, trusted-proxy configuration, request IDs, and redacted JSON logs are enabled.
- Failed events are retained for administrator review and explicit retry. History remains append-only.
- Quarterly checks: RLS cross-tenant tests, secret rotation, dependency audit, restore drill, webhook replay test, access review, and load test.
- Residual operational risks: provider token expiry, provider outages, and incorrect proxy configuration. Monitor failures and keep connector credentials current.

