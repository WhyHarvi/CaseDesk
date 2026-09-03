---
type: database-model
status: active
risk: high
---

# WorkerLease

## Purpose
Coordinates singleton-like worker passes across multiple backend processes.

## Important Fields
Primary `leaseKey`, `ownerId`, expiry, and update timestamp.

## Relationships
No tenant or foreign-key relationship; lease keys identify global worker responsibilities.

## Features and Services
[[Backend-Architecture]], [[Notifications]], communication automation, and other polling workers through `backend/src/services/workerLeaseService.js`.

## Deletion and Rules
Expired leases are reclaimable. Lease duration must exceed expected pass duration or be renewed; global keys must not accidentally serialize unrelated work or permit concurrent duplicate processing.
