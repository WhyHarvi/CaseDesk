---
type: system
status: active
risk: high
---

# Backend Architecture

The backend is an ES-module Express application. `backend/src/server.js` owns middleware order, route mounts, background-worker lifecycle, health checks, and graceful shutdown.

## Layers

- Routes in `backend/src/routes/` and module routes in `backend/src/modules/` compose authentication, roles, portal gates, upload middleware, and controllers.
- Controllers in `backend/src/controllers/` validate HTTP inputs and coordinate domain operations.
- Services in `backend/src/services/` contain provider adapters, document/PDF work, ledgers, policies, automation, and worker loops.
- Larger domains use `backend/src/modules/leads/`, `backend/src/modules/workload/`, and `backend/src/modules/case-information/`.
- `backend/src/services/prisma/client.js` supplies the shared Prisma client; `backend/prisma/schema.prisma` defines persistence.

## Background Work

Workers poll durable database queues/state rather than using a separate queue product. `backend/src/services/workerLeaseService.js` provides database leases where implemented. Shutdown handlers stop all registered workers and disconnect Prisma.

## Error and Security Handling

`backend/src/middleware/productionSecurity.js` adds request IDs and headers. `backend/src/middleware/errorHandler.js` hides internal and Prisma error detail. Upload middleware uses in-memory Multer with type/count/size limits before storage services persist content.

## Tests

`backend/test/` uses Node's test runner. Tests range from pure service tests to route/source regression tests. Run from `backend/` with `npm test`.
