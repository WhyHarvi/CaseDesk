ALTER TABLE "cases"
ADD COLUMN "archived_at" TIMESTAMP(3);

CREATE INDEX "cases_agency_id_archived_at_idx"
ON "cases"("agency_id", "archived_at");
