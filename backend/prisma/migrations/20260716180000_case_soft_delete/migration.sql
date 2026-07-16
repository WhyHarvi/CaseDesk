ALTER TABLE "cases" ADD COLUMN "deleted_at" TIMESTAMP(3);

CREATE INDEX "cases_agency_id_deleted_at_idx" ON "cases"("agency_id", "deleted_at");
