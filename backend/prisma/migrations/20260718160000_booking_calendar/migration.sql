-- Appointments become bookable standalone (no case/client required, guest bookings)
ALTER TABLE "appointments" ALTER COLUMN "client_id" DROP NOT NULL;
ALTER TABLE "appointments" ALTER COLUMN "case_id" DROP NOT NULL;
ALTER TABLE "appointments" ALTER COLUMN "created_by_id" DROP NOT NULL;
ALTER TABLE "appointments"
  ADD COLUMN "session_type_id" TEXT,
  ADD COLUMN "guest_name" TEXT,
  ADD COLUMN "guest_email" TEXT,
  ADD COLUMN "guest_phone" TEXT;

ALTER TABLE "appointments" DROP CONSTRAINT "appointments_created_by_id_fkey";
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP INDEX IF EXISTS "appointments_assigned_to_id_idx";
CREATE INDEX "appointments_assigned_to_id_starts_at_idx" ON "appointments"("assigned_to_id", "starts_at");
CREATE INDEX "appointments_agency_id_starts_at_idx" ON "appointments"("agency_id", "starts_at");

CREATE TABLE "booking_settings" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "timezone" TEXT NOT NULL DEFAULT 'America/Toronto',
  "working_hours" JSONB NOT NULL DEFAULT '[]',
  "days_off" JSONB NOT NULL DEFAULT '[]',
  "buffer_minutes" INTEGER NOT NULL DEFAULT 15,
  "min_notice_minutes" INTEGER NOT NULL DEFAULT 720,
  "horizon_days" INTEGER NOT NULL DEFAULT 30,
  "reminder_minutes" INTEGER NOT NULL DEFAULT 1440,
  "public_token" TEXT NOT NULL,
  "public_booking_enabled" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "booking_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "booking_settings_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "booking_settings_agency_id_key" ON "booking_settings"("agency_id");
CREATE UNIQUE INDEX "booking_settings_public_token_key" ON "booking_settings"("public_token");

CREATE TABLE "booking_session_types" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "duration_minutes" INTEGER NOT NULL,
  "description" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "booking_session_types_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "booking_session_types_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "booking_session_types_agency_id_is_active_idx" ON "booking_session_types"("agency_id", "is_active");

ALTER TABLE "appointments" ADD CONSTRAINT "appointments_session_type_id_fkey"
  FOREIGN KEY ("session_type_id") REFERENCES "booking_session_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "booking_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "booking_session_types" ENABLE ROW LEVEL SECURITY;
CREATE POLICY booking_settings_staff ON "booking_settings" FOR ALL TO authenticated
  USING ("agency_id" = current_agency_id() AND current_user_role() IN ('admin', 'consultant', 'frontdesk'))
  WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() = 'admin');
CREATE POLICY booking_session_types_staff ON "booking_session_types" FOR ALL TO authenticated
  USING ("agency_id" = current_agency_id() AND current_user_role() IN ('admin', 'consultant', 'frontdesk'))
  WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() = 'admin');
