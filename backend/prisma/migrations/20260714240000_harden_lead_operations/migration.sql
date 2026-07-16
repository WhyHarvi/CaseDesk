CREATE TABLE "api_rate_limit_buckets" (
  "key" TEXT PRIMARY KEY,
  "count" INTEGER NOT NULL DEFAULT 1,
  "reset_at" TIMESTAMP(3) NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "api_rate_limit_buckets_reset_at_idx" ON "api_rate_limit_buckets"("reset_at");
ALTER TABLE "api_rate_limit_buckets" ENABLE ROW LEVEL SECURITY;

CREATE INDEX "lead_incoming_events_agency_id_status_created_at_idx" ON "lead_incoming_events"("agency_id", "status", "created_at");
CREATE INDEX "lead_incoming_events_agency_id_status_available_at_idx" ON "lead_incoming_events"("agency_id", "status", "available_at");
CREATE INDEX "lead_incoming_events_failed_review_idx" ON "lead_incoming_events"("agency_id", "created_at" DESC) WHERE "status" = 'FAILED';
CREATE INDEX "lead_source_connections_agency_id_is_active_last_event_at_idx" ON "lead_source_connections"("agency_id", "is_active", "last_event_at");
CREATE INDEX "leads_agency_id_status_owner_user_id_stage_idx" ON "leads"("agency_id", "status", "owner_user_id", "stage");

