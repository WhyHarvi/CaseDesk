CREATE TABLE "case_assessments" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "case_id" TEXT NOT NULL,
  "user_id" TEXT,
  "form_data" JSONB NOT NULL DEFAULT '{}',
  "crs_score" INTEGER NOT NULL DEFAULT 0,
  "crs_breakdown" JSONB NOT NULL DEFAULT '{}',
  "declared_complete" BOOLEAN NOT NULL DEFAULT false,
  "declared_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "case_assessments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "case_assessments_agency_id_case_id_key" ON "case_assessments"("agency_id", "case_id");
CREATE UNIQUE INDEX "case_assessments_case_id_key" ON "case_assessments"("case_id");
CREATE INDEX "case_assessments_agency_id_idx" ON "case_assessments"("agency_id");
CREATE INDEX "case_assessments_client_id_idx" ON "case_assessments"("client_id");
CREATE INDEX "case_assessments_user_id_idx" ON "case_assessments"("user_id");

ALTER TABLE "case_assessments"
  ADD CONSTRAINT "case_assessments_agency_id_fkey"
  FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "case_assessments"
  ADD CONSTRAINT "case_assessments_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "case_assessments"
  ADD CONSTRAINT "case_assessments_case_id_fkey"
  FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "case_assessments"
  ADD CONSTRAINT "case_assessments_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
