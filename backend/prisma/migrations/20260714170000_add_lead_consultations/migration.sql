CREATE TYPE "LeadConsultationStatus" AS ENUM ('SCHEDULED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'RESCHEDULED', 'NO_SHOW');
CREATE TYPE "LeadConsultationOutcome" AS ENUM ('READY_TO_PROCEED', 'AGREEMENT_REQUIRED', 'PAYMENT_REQUIRED', 'FOLLOW_UP_REQUIRED', 'NOT_ELIGIBLE', 'NOT_INTERESTED', 'FUTURE_OPPORTUNITY', 'LOST');

CREATE TABLE "lead_consultations" (
  "id" TEXT PRIMARY KEY,
  "agency_id" TEXT NOT NULL REFERENCES "agencies"("id") ON DELETE CASCADE,
  "lead_id" TEXT NOT NULL REFERENCES "leads"("id") ON DELETE CASCADE,
  "consultant_user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_by_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "start_at" TIMESTAMP(3) NOT NULL,
  "end_at" TIMESTAMP(3) NOT NULL,
  "timezone" TEXT NOT NULL DEFAULT 'America/Toronto',
  "appointment_type" TEXT NOT NULL,
  "status" "LeadConsultationStatus" NOT NULL DEFAULT 'SCHEDULED',
  "fee" DECIMAL(10,2),
  "payment_status" TEXT NOT NULL DEFAULT 'UNPAID',
  "confirmation_status" TEXT NOT NULL DEFAULT 'PENDING',
  "reminder_status" TEXT NOT NULL DEFAULT 'PENDING',
  "location" TEXT,
  "meeting_url" TEXT,
  "outcome" "LeadConsultationOutcome",
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lead_consultations_time_check" CHECK ("end_at" > "start_at"),
  CONSTRAINT "lead_consultations_fee_check" CHECK ("fee" IS NULL OR "fee" >= 0),
  CONSTRAINT "lead_consultations_completion_check" CHECK ("status" <> 'COMPLETED' OR "outcome" IS NOT NULL)
);

CREATE INDEX "lead_consultations_agency_id_start_at_idx" ON "lead_consultations"("agency_id", "start_at");
CREATE INDEX "lead_consultations_agency_id_consultant_user_id_start_at_idx" ON "lead_consultations"("agency_id", "consultant_user_id", "start_at");
CREATE INDEX "lead_consultations_agency_id_lead_id_start_at_idx" ON "lead_consultations"("agency_id", "lead_id", "start_at");

ALTER TABLE "lead_consultations" ENABLE ROW LEVEL SECURITY;

CREATE POLICY lead_consultations_read ON "lead_consultations" FOR SELECT TO authenticated USING (
  "agency_id" = current_agency_id() AND EXISTS (
    SELECT 1 FROM "leads" l WHERE l.id = "lead_id"
      AND (current_user_role() = 'admin' OR l."owner_user_id" = current_app_user_id() OR "consultant_user_id" = current_app_user_id())
  )
);

CREATE POLICY lead_consultations_insert ON "lead_consultations" FOR INSERT TO authenticated WITH CHECK (
  "agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant') AND EXISTS (
    SELECT 1 FROM "leads" l WHERE l.id = "lead_id" AND l."agency_id" = current_agency_id()
      AND (current_user_role() = 'admin' OR l."owner_user_id" = current_app_user_id())
  )
);

CREATE POLICY lead_consultations_update ON "lead_consultations" FOR UPDATE TO authenticated
  USING (
    "agency_id" = current_agency_id() AND EXISTS (
      SELECT 1 FROM "leads" l WHERE l.id = "lead_id"
        AND (current_user_role() = 'admin' OR l."owner_user_id" = current_app_user_id() OR "consultant_user_id" = current_app_user_id())
    )
  )
  WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant'));
