CREATE TABLE "incentive_milestone_events" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "case_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "trigger_source" TEXT NOT NULL,
  "trigger_ref" TEXT NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "actor_user_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMP(3),
  CONSTRAINT "incentive_milestone_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "incentive_milestone_events_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE,
  CONSTRAINT "incentive_milestone_events_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE,
  CONSTRAINT "incentive_milestone_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX "incentive_milestone_events_trigger_key" ON "incentive_milestone_events"("agency_id", "trigger_source", "trigger_ref", "event_type");
CREATE INDEX "incentive_milestone_events_status_created_idx" ON "incentive_milestone_events"("status", "created_at");
