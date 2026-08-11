ALTER TABLE "agency_ooma_settings"
  ADD COLUMN IF NOT EXISTS "last_call_webhook_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_sms_webhook_at" TIMESTAMP(3);

CREATE TABLE "ooma_call_sessions" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "provider_call_id" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "remote_number" TEXT,
  "remote_number_normalized" TEXT,
  "business_number" TEXT,
  "extension_label" TEXT,
  "handled_by_user_id" TEXT,
  "client_id" TEXT,
  "case_id" TEXT,
  "lead_id" TEXT,
  "follow_up_id" TEXT,
  "resolution" TEXT NOT NULL DEFAULT 'UNRESOLVED',
  "disposition" TEXT,
  "outcome_notes" TEXT,
  "started_at" TIMESTAMP(3) NOT NULL,
  "answered_at" TIMESTAMP(3),
  "ended_at" TIMESTAMP(3),
  "duration_seconds" INTEGER,
  "recording_url" TEXT,
  "transcript" TEXT,
  "last_event_at" TIMESTAMP(3) NOT NULL,
  "resolved_at" TIMESTAMP(3),
  "resolved_by_id" TEXT,
  "raw_payload" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ooma_call_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ooma_call_events" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "call_session_id" TEXT NOT NULL,
  "provider_event_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ooma_call_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ooma_call_sessions_agency_id_provider_call_id_key"
  ON "ooma_call_sessions"("agency_id", "provider_call_id");
CREATE INDEX "ooma_call_sessions_follow_up_id_idx"
  ON "ooma_call_sessions"("follow_up_id");
CREATE INDEX "ooma_call_sessions_agency_id_resolution_last_event_at_idx"
  ON "ooma_call_sessions"("agency_id", "resolution", "last_event_at");
CREATE INDEX "ooma_call_sessions_agency_id_status_last_event_at_idx"
  ON "ooma_call_sessions"("agency_id", "status", "last_event_at");
CREATE INDEX "ooma_call_sessions_agency_id_remote_number_normalized_idx"
  ON "ooma_call_sessions"("agency_id", "remote_number_normalized");
CREATE INDEX "ooma_call_sessions_lead_id_started_at_idx"
  ON "ooma_call_sessions"("lead_id", "started_at");
CREATE INDEX "ooma_call_sessions_client_id_started_at_idx"
  ON "ooma_call_sessions"("client_id", "started_at");

CREATE UNIQUE INDEX "ooma_call_events_agency_id_provider_event_id_key"
  ON "ooma_call_events"("agency_id", "provider_event_id");
CREATE INDEX "ooma_call_events_call_session_id_occurred_at_idx"
  ON "ooma_call_events"("call_session_id", "occurred_at");
CREATE INDEX "ooma_call_events_agency_id_event_type_occurred_at_idx"
  ON "ooma_call_events"("agency_id", "event_type", "occurred_at");

ALTER TABLE "ooma_call_sessions"
  ADD CONSTRAINT "ooma_call_sessions_agency_id_fkey"
  FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ooma_call_sessions"
  ADD CONSTRAINT "ooma_call_sessions_handled_by_user_id_fkey"
  FOREIGN KEY ("handled_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ooma_call_sessions"
  ADD CONSTRAINT "ooma_call_sessions_resolved_by_id_fkey"
  FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ooma_call_sessions"
  ADD CONSTRAINT "ooma_call_sessions_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ooma_call_sessions"
  ADD CONSTRAINT "ooma_call_sessions_case_id_fkey"
  FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ooma_call_sessions"
  ADD CONSTRAINT "ooma_call_sessions_lead_id_fkey"
  FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ooma_call_sessions"
  ADD CONSTRAINT "ooma_call_sessions_follow_up_id_fkey"
  FOREIGN KEY ("follow_up_id") REFERENCES "lead_follow_ups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ooma_call_events"
  ADD CONSTRAINT "ooma_call_events_agency_id_fkey"
  FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ooma_call_events"
  ADD CONSTRAINT "ooma_call_events_call_session_id_fkey"
  FOREIGN KEY ("call_session_id") REFERENCES "ooma_call_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ooma_call_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ooma_call_events" ENABLE ROW LEVEL SECURITY;
