import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma from "../../services/prisma/client.js";

// ~2.5x the frontend's 60s ping interval — bounds how much a single missed
// or late ping (laptop sleep, backgrounded tab, network drop) can inflate
// active time, without needing the client to send an explicit "session
// ended" signal (which tab-close can't reliably deliver anyway).
const MAX_PING_GAP_SECONDS = 150;

// One row per (agency, user, calendar day) — an atomic upsert rather than
// read-then-write, since this can run at up to one write per minute per
// active staff member, the highest-frequency mutation in the app when many
// people are online. UTC calendar day is a deliberate simplicity tradeoff
// for a coarse usage rollup; real deadline logic elsewhere uses agency-
// timezone-correct boundaries (see lead.metrics.js's reportingBounds), but
// that precision isn't needed for "roughly how long were they active today."
export async function recordPortalActivityPing({ agencyId, userId }, now = new Date(), db = prisma) {
  const activityDate = now.toISOString().slice(0, 10);
  await db.$executeRaw(Prisma.sql`
    INSERT INTO "user_portal_activity"
      (id, agency_id, user_id, activity_date, active_seconds, ping_count, first_ping_at, last_ping_at, created_at, updated_at)
    VALUES (${randomUUID()}, ${agencyId}, ${userId}, ${activityDate}::date, 0, 1, ${now}, ${now}, ${now}, ${now})
    ON CONFLICT (agency_id, user_id, activity_date) DO UPDATE SET
      active_seconds = "user_portal_activity".active_seconds
        + LEAST(GREATEST(EXTRACT(EPOCH FROM (${now}::timestamp - "user_portal_activity".last_ping_at)), 0), ${MAX_PING_GAP_SECONDS}),
      ping_count = "user_portal_activity".ping_count + 1,
      last_ping_at = ${now},
      updated_at = ${now}
  `);
}
