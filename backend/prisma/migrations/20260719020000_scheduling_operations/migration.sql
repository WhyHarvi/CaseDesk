ALTER TABLE "booking_settings"
  ADD COLUMN "free_consultations_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "free_consultations_per_contact" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "cancellation_cutoff_minutes" INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN "reschedule_cutoff_minutes" INTEGER NOT NULL DEFAULT 60;

ALTER TABLE "booking_session_types"
  ADD COLUMN "allowed_meeting_modes" TEXT[] NOT NULL DEFAULT ARRAY['InPerson', 'Online']::TEXT[],
  ADD COLUMN "allowed_location_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "appointments"
  ADD COLUMN "lead_id" TEXT,
  ADD COLUMN "guest_email_normalized" TEXT,
  ADD COLUMN "reminder_due_at" TIMESTAMP(3),
  ADD COLUMN "reminder_queued_at" TIMESTAMP(3),
  ADD COLUMN "cancelled_by_id" TEXT,
  ADD COLUMN "cancelled_at" TIMESTAMP(3),
  ADD COLUMN "cancellation_reason" TEXT,
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'Internal',
  ADD COLUMN "is_free_consultation" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "idempotency_key" TEXT;

UPDATE "appointments"
SET
  "guest_email_normalized" = LOWER(TRIM("guest_email")),
  "reminder_due_at" = "starts_at" - INTERVAL '24 hours'
WHERE "guest_email" IS NOT NULL OR ("status" = 'Scheduled' AND "starts_at" > NOW());

ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "appointments_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "appointments_agency_id_idempotency_key_key" ON "appointments"("agency_id", "idempotency_key");
CREATE INDEX "appointments_agency_id_status_starts_at_idx" ON "appointments"("agency_id", "status", "starts_at");
CREATE INDEX "appointments_agency_id_reminder_due_at_reminder_queued_at_idx" ON "appointments"("agency_id", "reminder_due_at", "reminder_queued_at");
CREATE INDEX "appointments_lead_id_idx" ON "appointments"("lead_id");

CREATE TABLE "scheduling_staff_preferences" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "accepts_appointments" BOOLEAN NOT NULL DEFAULT true,
  "public_bookable" BOOLEAN NOT NULL DEFAULT true,
  "max_daily_appointments" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "scheduling_staff_preferences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "scheduling_staff_preferences_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "scheduling_staff_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "scheduling_staff_preferences" ("id", "agency_id", "user_id", "accepts_appointments", "public_bookable", "updated_at")
SELECT
  md5('scheduling-staff:' || am.id),
  am.agency_id,
  am.user_id,
  CASE WHEN am.role = 'consultant' THEN true ELSE false END,
  CASE WHEN am.role = 'consultant' THEN true ELSE false END,
  NOW()
FROM "agency_members" am
JOIN "users" u ON u.id = am.user_id AND u.status = 'active'
WHERE am.is_active = true AND am.role IN ('admin', 'consultant')
ON CONFLICT DO NOTHING;

CREATE UNIQUE INDEX "scheduling_staff_preferences_user_id_key" ON "scheduling_staff_preferences"("user_id");
CREATE INDEX "scheduling_staff_preferences_agency_id_accepts_appointments_public_bookable_idx" ON "scheduling_staff_preferences"("agency_id", "accepts_appointments", "public_bookable");

CREATE TABLE "booking_session_type_staff" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "session_type_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "booking_session_type_staff_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "booking_session_type_staff_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "booking_session_type_staff_session_type_id_fkey" FOREIGN KEY ("session_type_id") REFERENCES "booking_session_types"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "booking_session_type_staff_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "booking_session_type_staff_session_type_id_user_id_key" ON "booking_session_type_staff"("session_type_id", "user_id");
CREATE INDEX "booking_session_type_staff_agency_id_user_id_idx" ON "booking_session_type_staff"("agency_id", "user_id");

CREATE TABLE "booking_message_deliveries" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "appointment_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "recipient" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 5,
  "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sent_at" TIMESTAMP(3),
  "failed_at" TIMESTAMP(3),
  "provider_id" TEXT,
  "last_error" TEXT,
  "dedupe_key" TEXT NOT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "booking_message_deliveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "booking_message_deliveries_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "booking_message_deliveries_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "booking_message_deliveries_dedupe_key_key" ON "booking_message_deliveries"("dedupe_key");
CREATE INDEX "booking_message_deliveries_status_available_at_idx" ON "booking_message_deliveries"("status", "available_at");
CREATE INDEX "booking_message_deliveries_appointment_id_created_at_idx" ON "booking_message_deliveries"("appointment_id", "created_at");

ALTER TABLE "lead_consultations" ADD COLUMN "appointment_id" TEXT;

INSERT INTO "appointments" (
  "id", "agency_id", "lead_id", "subject", "location", "calendar", "starts_at", "ends_at", "description",
  "guest_name", "guest_email", "guest_email_normalized", "guest_phone", "meeting_mode", "meeting_url", "manage_token",
  "reminder_due_at", "assigned_to_id", "created_by_id", "status", "source", "created_at", "updated_at"
)
SELECT
  md5('lead-consultation:' || lc.id),
  lc.agency_id,
  lc.lead_id,
  'Lead consultation',
  lc.location,
  'Workspace Calendar',
  lc.start_at,
  lc.end_at,
  lc.notes,
  TRIM(CONCAT_WS(' ', l.first_name, l.last_name)),
  l.email,
  LOWER(TRIM(l.email)),
  l.phone,
  CASE WHEN lc.appointment_type = 'VIDEO' THEN 'Online' ELSE 'InPerson' END,
  lc.meeting_url,
  md5('lead-consultation-manage:' || lc.id),
  lc.start_at - INTERVAL '24 hours',
  lc.consultant_user_id,
  lc.created_by_id,
  CASE
    WHEN lc.status = 'COMPLETED' THEN 'Completed'::"AppointmentStatus"
    WHEN lc.status = 'CANCELLED' THEN 'Cancelled'::"AppointmentStatus"
    WHEN lc.status = 'NO_SHOW' THEN 'NoShow'::"AppointmentStatus"
    ELSE 'Scheduled'::"AppointmentStatus"
  END,
  'Lead',
  lc.created_at,
  lc.updated_at
FROM "lead_consultations" lc
JOIN "leads" l ON l.id = lc.lead_id
WHERE NOT EXISTS (SELECT 1 FROM "appointments" a WHERE a.id = md5('lead-consultation:' || lc.id));

UPDATE "lead_consultations"
SET "appointment_id" = md5('lead-consultation:' || id)
WHERE "appointment_id" IS NULL;

CREATE UNIQUE INDEX "lead_consultations_appointment_id_key" ON "lead_consultations"("appointment_id");
ALTER TABLE "lead_consultations" ADD CONSTRAINT "lead_consultations_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "scheduling_staff_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "booking_session_type_staff" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "booking_message_deliveries" ENABLE ROW LEVEL SECURITY;

CREATE POLICY scheduling_staff_preferences_staff ON "scheduling_staff_preferences" FOR SELECT TO authenticated
  USING ("agency_id" = current_agency_id() AND current_user_role() IN ('admin', 'consultant', 'frontdesk'));
CREATE POLICY scheduling_staff_preferences_admin_write ON "scheduling_staff_preferences" FOR ALL TO authenticated
  USING ("agency_id" = current_agency_id() AND current_user_role() = 'admin')
  WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() = 'admin');
CREATE POLICY booking_session_type_staff_staff ON "booking_session_type_staff" FOR SELECT TO authenticated
  USING ("agency_id" = current_agency_id() AND current_user_role() IN ('admin', 'consultant', 'frontdesk'));
CREATE POLICY booking_session_type_staff_admin_write ON "booking_session_type_staff" FOR ALL TO authenticated
  USING ("agency_id" = current_agency_id() AND current_user_role() = 'admin')
  WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() = 'admin');
CREATE POLICY booking_message_deliveries_admin ON "booking_message_deliveries" FOR SELECT TO authenticated
  USING ("agency_id" = current_agency_id() AND current_user_role() = 'admin');
