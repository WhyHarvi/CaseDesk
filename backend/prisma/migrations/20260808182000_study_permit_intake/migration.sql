ALTER TABLE "cases"
    ADD COLUMN "study_intake_month" DATE;

CREATE INDEX "cases_agency_id_study_intake_month_idx"
    ON "cases"("agency_id", "study_intake_month");
