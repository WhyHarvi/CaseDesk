CREATE TYPE "LeadQualificationOutcome" AS ENUM (
  'QUALIFIED',
  'MORE_INFORMATION_REQUIRED',
  'CONSULTATION_REQUIRED',
  'NOT_ELIGIBLE',
  'FUTURE_OPPORTUNITY',
  'SERVICE_NOT_OFFERED'
);

CREATE TABLE "lead_qualifications" (
  "id" TEXT PRIMARY KEY,
  "agency_id" TEXT NOT NULL REFERENCES "agencies"("id") ON DELETE CASCADE,
  "lead_id" TEXT NOT NULL UNIQUE REFERENCES "leads"("id") ON DELETE CASCADE,
  "immigration_service" TEXT,
  "current_country" TEXT,
  "current_immigration_status" TEXT,
  "status_expiry_date" TIMESTAMP(3),
  "preferred_destination" TEXT,
  "education" TEXT,
  "work_experience" TEXT,
  "language_test" TEXT,
  "previous_refusals" BOOLEAN,
  "family_status" TEXT,
  "estimated_budget" DECIMAL(12,2),
  "preferred_consultation_at" TIMESTAMP(3),
  "urgency" "LeadPriority",
  "notes" TEXT,
  "eligibility_confidence" INTEGER,
  "outcome" "LeadQualificationOutcome" NOT NULL,
  "completed_by" TEXT NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "completed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lead_qualifications_confidence_check" CHECK ("eligibility_confidence" IS NULL OR "eligibility_confidence" BETWEEN 0 AND 100),
  CONSTRAINT "lead_qualifications_budget_check" CHECK ("estimated_budget" IS NULL OR "estimated_budget" >= 0)
);

CREATE INDEX "lead_qualifications_agency_id_outcome_completed_at_idx"
  ON "lead_qualifications"("agency_id", "outcome", "completed_at");

ALTER TABLE "lead_qualifications" ENABLE ROW LEVEL SECURITY;

CREATE POLICY lead_qualifications_read ON "lead_qualifications" FOR SELECT TO authenticated USING (
  "agency_id" = current_agency_id() AND EXISTS (
    SELECT 1 FROM "leads" l
    WHERE l.id = "lead_id" AND (current_user_role() = 'admin' OR l."owner_user_id" = current_app_user_id())
  )
);

CREATE POLICY lead_qualifications_insert ON "lead_qualifications" FOR INSERT TO authenticated WITH CHECK (
  "agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant') AND EXISTS (
    SELECT 1 FROM "leads" l
    WHERE l.id = "lead_id" AND l."agency_id" = current_agency_id()
      AND (current_user_role() = 'admin' OR l."owner_user_id" = current_app_user_id())
  )
);

CREATE POLICY lead_qualifications_update ON "lead_qualifications" FOR UPDATE TO authenticated
  USING (
    "agency_id" = current_agency_id() AND EXISTS (
      SELECT 1 FROM "leads" l
      WHERE l.id = "lead_id" AND (current_user_role() = 'admin' OR l."owner_user_id" = current_app_user_id())
    )
  )
  WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant'));
