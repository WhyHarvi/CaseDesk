ALTER TABLE "appointments"
  ADD COLUMN "reference_code" TEXT,
  ADD COLUMN "confirmation_status" TEXT NOT NULL DEFAULT 'Awaiting',
  ADD COLUMN "confirmed_at" TIMESTAMP(3),
  ADD COLUMN "preparation_completed_at" TIMESTAMP(3),
  ADD COLUMN "series_key" TEXT,
  ADD COLUMN "recurrence_index" INTEGER,
  ADD COLUMN "recurrence_count" INTEGER;

UPDATE "appointments"
SET "reference_code" = 'APT-' || UPPER(LEFT(MD5("id"), 8))
WHERE "reference_code" IS NULL;

CREATE UNIQUE INDEX "appointments_reference_code_key" ON "appointments"("reference_code");
CREATE INDEX "appointments_agency_id_series_key_recurrence_index_idx" ON "appointments"("agency_id", "series_key", "recurrence_index");
CREATE INDEX "appointments_agency_id_confirmation_status_starts_at_idx" ON "appointments"("agency_id", "confirmation_status", "starts_at");

ALTER TABLE "booking_settings"
  ADD COLUMN "reminder_schedule" JSONB NOT NULL DEFAULT '[1440]',
  ADD COLUMN "message_templates" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "waitlist_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "attendance_confirmation_enabled" BOOLEAN NOT NULL DEFAULT true;

UPDATE "booking_settings"
SET "reminder_schedule" = JSONB_BUILD_ARRAY("reminder_minutes");

ALTER TABLE "booking_session_types"
  ADD COLUMN "buffer_minutes" INTEGER,
  ADD COLUMN "preparation_instructions" TEXT,
  ADD COLUMN "preparation_checklist" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "parking_instructions" TEXT;

ALTER TABLE "scheduling_staff_preferences"
  ADD COLUMN "timezone" TEXT,
  ADD COLUMN "working_hours" JSONB,
  ADD COLUMN "days_off" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "buffer_minutes" INTEGER;

CREATE TABLE "scheduling_blocks" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "starts_at" TIMESTAMP(3) NOT NULL,
  "ends_at" TIMESTAMP(3) NOT NULL,
  "recurrence" TEXT,
  "recurrence_until" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "scheduling_blocks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "scheduling_blocks_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "scheduling_blocks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "scheduling_blocks_agency_id_user_id_starts_at_ends_at_idx" ON "scheduling_blocks"("agency_id", "user_id", "starts_at", "ends_at");

CREATE TABLE "booking_waitlist_entries" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "session_type_id" TEXT NOT NULL,
  "preferred_user_id" TEXT,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "email_normalized" TEXT NOT NULL,
  "phone" TEXT,
  "meeting_mode" TEXT NOT NULL DEFAULT 'InPerson',
  "location_id" TEXT,
  "preferred_from" TIMESTAMP(3) NOT NULL,
  "preferred_to" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'Waiting',
  "offered_starts_at" TIMESTAMP(3),
  "offer_token" TEXT,
  "offer_expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "booking_waitlist_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "booking_waitlist_entries_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "booking_waitlist_entries_offer_token_key" ON "booking_waitlist_entries"("offer_token");
CREATE INDEX "booking_waitlist_entries_agency_id_session_type_id_status_created_at_idx" ON "booking_waitlist_entries"("agency_id", "session_type_id", "status", "created_at");
CREATE INDEX "booking_waitlist_entries_agency_id_email_normalized_idx" ON "booking_waitlist_entries"("agency_id", "email_normalized");

CREATE TABLE "booking_verification_codes" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "email_normalized" TEXT NOT NULL,
  "code_hash" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "verified_at" TIMESTAMP(3),
  "verification_token" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "booking_verification_codes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "booking_verification_codes_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "booking_verification_codes_verification_token_key" ON "booking_verification_codes"("verification_token");
CREATE INDEX "booking_verification_codes_agency_id_email_normalized_expires_at_idx" ON "booking_verification_codes"("agency_id", "email_normalized", "expires_at");

CREATE TABLE "appointment_events" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "appointment_id" TEXT NOT NULL,
  "actor_user_id" TEXT,
  "type" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "appointment_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "appointment_events_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "appointment_events_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "appointment_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "appointment_events_appointment_id_created_at_idx" ON "appointment_events"("appointment_id", "created_at");
CREATE INDEX "appointment_events_agency_id_type_created_at_idx" ON "appointment_events"("agency_id", "type", "created_at");

ALTER TABLE "scheduling_blocks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "booking_waitlist_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "booking_verification_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "appointment_events" ENABLE ROW LEVEL SECURITY;

CREATE POLICY scheduling_blocks_staff_read ON "scheduling_blocks" FOR SELECT TO authenticated
  USING ("agency_id" = current_agency_id() AND current_user_role() IN ('admin', 'consultant'));
CREATE POLICY scheduling_blocks_staff_write ON "scheduling_blocks" FOR ALL TO authenticated
  USING ("agency_id" = current_agency_id() AND (current_user_role() = 'admin' OR "user_id" = current_app_user_id()))
  WITH CHECK ("agency_id" = current_agency_id() AND (current_user_role() = 'admin' OR "user_id" = current_app_user_id()));
CREATE POLICY booking_waitlist_admin ON "booking_waitlist_entries" FOR ALL TO authenticated
  USING ("agency_id" = current_agency_id() AND current_user_role() = 'admin')
  WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() = 'admin');
CREATE POLICY appointment_events_staff_read ON "appointment_events" FOR SELECT TO authenticated
  USING ("agency_id" = current_agency_id() AND (current_user_role() = 'admin' OR EXISTS (SELECT 1 FROM appointments a WHERE a.id = appointment_events.appointment_id AND a.assigned_to_id = current_app_user_id())));
