CREATE TABLE "immigration_profiles" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "profile_type" TEXT NOT NULL DEFAULT 'Applicant',
  "given_names" TEXT NOT NULL,
  "family_name" TEXT NOT NULL,
  "date_of_birth" TIMESTAMP(3),
  "relationship" TEXT,
  "uci" TEXT,
  "application_number" TEXT,
  "communication_email" TEXT,
  "login_username" TEXT,
  "login_username_normalized" TEXT,
  "password_hash" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "immigration_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "immigration_profile_case_accesses" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "profile_id" TEXT NOT NULL,
  "case_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "immigration_profile_case_accesses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "immigration_profiles_agency_id_login_username_normalized_key"
  ON "immigration_profiles"("agency_id", "login_username_normalized");
CREATE INDEX "immigration_profiles_agency_id_idx" ON "immigration_profiles"("agency_id");
CREATE UNIQUE INDEX "immigration_profile_case_accesses_profile_id_case_id_key"
  ON "immigration_profile_case_accesses"("profile_id", "case_id");
CREATE INDEX "immigration_profile_case_accesses_agency_id_idx"
  ON "immigration_profile_case_accesses"("agency_id");
CREATE INDEX "immigration_profile_case_accesses_case_id_idx"
  ON "immigration_profile_case_accesses"("case_id");

ALTER TABLE "immigration_profiles"
  ADD CONSTRAINT "immigration_profiles_agency_id_fkey"
  FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "immigration_profile_case_accesses"
  ADD CONSTRAINT "immigration_profile_case_accesses_agency_id_fkey"
  FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "immigration_profile_case_accesses"
  ADD CONSTRAINT "immigration_profile_case_accesses_profile_id_fkey"
  FOREIGN KEY ("profile_id") REFERENCES "immigration_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "immigration_profile_case_accesses"
  ADD CONSTRAINT "immigration_profile_case_accesses_case_id_fkey"
  FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
