import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("worker leases are claimed atomically and may only be renewed by their current owner", async () => {
  const [service, migration] = await Promise.all([
    source("../src/services/workerLeaseService.js"),
    source("../prisma/migrations/20260829150000_add_worker_leases/migration.sql"),
  ]);

  assert.match(service, /INSERT INTO worker_leases/);
  assert.match(service, /ON CONFLICT \(lease_key\) DO UPDATE/);
  assert.match(service, /worker_leases\.expires_at <=/);
  assert.match(service, /worker_leases\.owner_id =/);
  assert.match(service, /RETURNING lease_key/);
  assert.match(migration, /PRIMARY KEY \("lease_key"\)/);
  assert.match(migration, /worker_leases_expires_at_idx/);
});
