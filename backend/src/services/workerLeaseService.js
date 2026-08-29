import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma from "./prisma/client.js";

const WORKER_OWNER_ID = `${process.pid}:${randomUUID()}`;

export async function acquireWorkerLease(leaseKey, { ttlMs, now = new Date() }) {
  const expiresAt = new Date(now.getTime() + ttlMs);
  const rows = await prisma.$queryRaw(Prisma.sql`
    INSERT INTO worker_leases (lease_key, owner_id, expires_at, updated_at)
    VALUES (${leaseKey}, ${WORKER_OWNER_ID}, ${expiresAt}, ${now})
    ON CONFLICT (lease_key) DO UPDATE
      SET owner_id = EXCLUDED.owner_id,
          expires_at = EXCLUDED.expires_at,
          updated_at = EXCLUDED.updated_at
      WHERE worker_leases.expires_at <= ${now}
         OR worker_leases.owner_id = ${WORKER_OWNER_ID}
    RETURNING lease_key
  `);
  return rows.length > 0;
}
