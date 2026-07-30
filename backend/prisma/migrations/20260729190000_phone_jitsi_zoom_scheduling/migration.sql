ALTER TABLE "booking_settings"
  ADD COLUMN "phone_booking_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "phone_caller_id" TEXT,
  ADD COLUMN "phone_call_instructions" TEXT,
  ADD COLUMN "zoom_booking_enabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "appointments"
  ADD COLUMN "meeting_phone_number" TEXT,
  ADD COLUMN "meeting_provider" TEXT,
  ADD COLUMN "meeting_provider_id" TEXT,
  ADD COLUMN "meeting_provider_host_id" TEXT,
  ADD COLUMN "meeting_sync_status" TEXT NOT NULL DEFAULT 'NotRequired',
  ADD COLUMN "meeting_sync_error" TEXT;

ALTER TABLE "booking_payment_holds"
  ADD COLUMN "meeting_phone_number" TEXT,
  ADD COLUMN "meeting_provider" TEXT;

UPDATE "appointments"
SET
  "meeting_provider" = 'Jitsi',
  "meeting_sync_status" = 'Ready'
WHERE "meeting_mode" = 'Online' AND "meeting_url" IS NOT NULL;

UPDATE "booking_payment_holds"
SET "meeting_provider" = 'Jitsi'
WHERE "meeting_mode" = 'Online';

CREATE TABLE "agency_zoom_connections" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "provider_account_id" TEXT NOT NULL,
  "account_name" TEXT,
  "connected_user_id" TEXT,
  "connected_user_email" TEXT,
  "access_token_encrypted" TEXT NOT NULL,
  "refresh_token_encrypted" TEXT NOT NULL,
  "access_token_expires_at" TIMESTAMP(3) NOT NULL,
  "granted_scopes" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'connected',
  "last_error" TEXT,
  "connected_by_id" TEXT,
  "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "agency_zoom_connections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "zoom_host_mappings" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "zoom_user_id" TEXT NOT NULL,
  "zoom_email" TEXT NOT NULL,
  "display_name" TEXT,
  "license_type" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "zoom_host_mappings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "appointment_meeting_jobs" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "appointment_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 8,
  "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_at" TIMESTAMP(3),
  "processed_at" TIMESTAMP(3),
  "last_error" TEXT,
  "dedupe_key" TEXT NOT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "appointment_meeting_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agency_zoom_connections_agency_id_key" ON "agency_zoom_connections"("agency_id");
CREATE UNIQUE INDEX "agency_zoom_connections_provider_account_id_key" ON "agency_zoom_connections"("provider_account_id");
CREATE INDEX "agency_zoom_connections_status_idx" ON "agency_zoom_connections"("status");

CREATE UNIQUE INDEX "zoom_host_mappings_user_id_key" ON "zoom_host_mappings"("user_id");
CREATE UNIQUE INDEX "zoom_host_mappings_agency_id_zoom_user_id_key" ON "zoom_host_mappings"("agency_id", "zoom_user_id");
CREATE INDEX "zoom_host_mappings_agency_id_status_idx" ON "zoom_host_mappings"("agency_id", "status");

CREATE UNIQUE INDEX "appointment_meeting_jobs_dedupe_key_key" ON "appointment_meeting_jobs"("dedupe_key");
CREATE INDEX "appointment_meeting_jobs_status_available_at_idx" ON "appointment_meeting_jobs"("status", "available_at");
CREATE INDEX "appointment_meeting_jobs_agency_id_appointment_id_idx" ON "appointment_meeting_jobs"("agency_id", "appointment_id");
CREATE INDEX "appointments_agency_id_meeting_provider_meeting_provider_id_idx" ON "appointments"("agency_id", "meeting_provider", "meeting_provider_id");

ALTER TABLE "agency_zoom_connections"
  ADD CONSTRAINT "agency_zoom_connections_agency_id_fkey"
  FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "zoom_host_mappings"
  ADD CONSTRAINT "zoom_host_mappings_agency_id_fkey"
  FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "zoom_host_mappings"
  ADD CONSTRAINT "zoom_host_mappings_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "appointment_meeting_jobs"
  ADD CONSTRAINT "appointment_meeting_jobs_agency_id_fkey"
  FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "appointment_meeting_jobs"
  ADD CONSTRAINT "appointment_meeting_jobs_appointment_id_fkey"
  FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- These tables are backend-owned integration state. In particular,
-- agency_zoom_connections contains encrypted OAuth credentials and must
-- never be readable through the browser's authenticated Supabase role.
-- The trusted backend database role bypasses RLS, so no client policies
-- are intentionally created for these tables.
ALTER TABLE "agency_zoom_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "zoom_host_mappings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "appointment_meeting_jobs" ENABLE ROW LEVEL SECURITY;
