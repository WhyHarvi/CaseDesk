# Intake load testing

Use a dedicated non-production agency and website connector. The script intentionally creates events.

Set `LOAD_TEST_CONFIRM=true`, `LOAD_TEST_WEBHOOK_URL`, and `LOAD_TEST_SIGNING_SECRET`. Optionally set `LOAD_TEST_REQUESTS` and `LOAD_TEST_CONCURRENCY`, then run `npm run load:test:intake` from `backend`.

Start with 100 requests at concurrency 10. Monitor API latency, PostgreSQL connections, oldest pending age, failure count, and worker drain time. Increase gradually. Stop if error rate exceeds 1%, p95 webhook acceptance exceeds one second, or pending age grows continuously. Delete test data only through an approved tenant-scoped maintenance procedure.
