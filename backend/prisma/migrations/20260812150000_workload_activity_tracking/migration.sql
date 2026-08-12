-- Coarse portal-usage tracking for the team workload dashboard, plus
-- additive per-attribution indexes needed for its per-person period
-- aggregation queries. Nothing here touches existing data.

CREATE TABLE "user_portal_activity" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "activity_date" DATE NOT NULL,
  "active_seconds" INTEGER NOT NULL DEFAULT 0,
  "ping_count" INTEGER NOT NULL DEFAULT 0,
  "first_ping_at" TIMESTAMP(3) NOT NULL,
  "last_ping_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "user_portal_activity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_portal_activity_agency_id_user_id_activity_date_key" ON "user_portal_activity"("agency_id", "user_id", "activity_date");
CREATE INDEX "user_portal_activity_agency_id_activity_date_idx" ON "user_portal_activity"("agency_id", "activity_date");

ALTER TABLE "user_portal_activity"
  ADD CONSTRAINT "user_portal_activity_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "user_portal_activity_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_portal_activity" ENABLE ROW LEVEL SECURITY;

-- Matches the existing activity_admin_read convention on activity_logs —
-- the backend's own Prisma connection does all reads/writes for the
-- heartbeat endpoint and the admin report; this policy only guards a
-- hypothetical direct client read.
CREATE POLICY user_portal_activity_admin_read ON "user_portal_activity" FOR SELECT TO authenticated
  USING ("agency_id" = current_agency_id() AND current_user_role() = 'admin');

CREATE INDEX "activity_logs_agency_id_user_id_created_at_idx" ON "activity_logs"("agency_id", "user_id", "created_at");
CREATE INDEX "ooma_call_sessions_agency_id_handled_by_user_id_started_at_idx" ON "ooma_call_sessions"("agency_id", "handled_by_user_id", "started_at");
CREATE INDEX "cash_transactions_created_by_id_occurred_at_idx" ON "cash_transactions"("created_by_id", "occurred_at");
CREATE INDEX "appointments_agency_id_created_by_id_created_at_idx" ON "appointments"("agency_id", "created_by_id", "created_at");
