ALTER TABLE "questionnaire_assignments"
  ADD COLUMN "correction_requested_at" TIMESTAMP(3),
  ADD COLUMN "correction_note" TEXT,
  ADD COLUMN "reviewed_at" TIMESTAMP(3),
  ADD COLUMN "reviewed_by_id" TEXT;
ALTER TABLE "questionnaire_assignments"
  ADD CONSTRAINT "questionnaire_assignments_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "client_information_profiles" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "section_key" TEXT NOT NULL,
  "data" JSONB NOT NULL DEFAULT '{}',
  "version" INTEGER NOT NULL DEFAULT 1,
  "updated_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "client_information_profiles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "client_information_profiles_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "client_information_profiles_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "client_information_profiles_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "client_information_profiles_agency_id_client_id_section_key_key" ON "client_information_profiles"("agency_id", "client_id", "section_key");
CREATE INDEX "client_information_profiles_agency_id_client_id_idx" ON "client_information_profiles"("agency_id", "client_id");

CREATE TABLE "case_information_profiles" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "case_id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "section_key" TEXT NOT NULL,
  "data" JSONB NOT NULL DEFAULT '{}',
  "version" INTEGER NOT NULL DEFAULT 1,
  "updated_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "case_information_profiles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "case_information_profiles_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "case_information_profiles_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "case_information_profiles_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "case_information_profiles_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "case_information_profiles_agency_id_case_id_section_key_key" ON "case_information_profiles"("agency_id", "case_id", "section_key");
CREATE INDEX "case_information_profiles_agency_id_case_id_idx" ON "case_information_profiles"("agency_id", "case_id");

CREATE TABLE "case_information_section_states" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "case_id" TEXT NOT NULL,
  "section_key" TEXT NOT NULL,
  "not_applicable" BOOLEAN NOT NULL DEFAULT false,
  "not_applicable_reason" TEXT,
  "verified_at" TIMESTAMP(3),
  "verified_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "case_information_section_states_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "case_information_section_states_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "case_information_section_states_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "case_information_section_states_verified_by_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "case_information_section_states_agency_id_case_id_section_key_key" ON "case_information_section_states"("agency_id", "case_id", "section_key");

ALTER TABLE "client_information_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "case_information_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "case_information_section_states" ENABLE ROW LEVEL SECURITY;

CREATE POLICY client_information_profiles_staff ON "client_information_profiles" FOR ALL TO authenticated
  USING ("agency_id" = current_agency_id() AND current_user_role() IN ('admin', 'consultant'))
  WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() IN ('admin', 'consultant'));
CREATE POLICY case_information_profiles_staff ON "case_information_profiles" FOR ALL TO authenticated
  USING ("agency_id" = current_agency_id() AND current_user_role() IN ('admin', 'consultant'))
  WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() IN ('admin', 'consultant'));
CREATE POLICY case_information_section_states_staff ON "case_information_section_states" FOR ALL TO authenticated
  USING ("agency_id" = current_agency_id() AND current_user_role() IN ('admin', 'consultant'))
  WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() IN ('admin', 'consultant'));
