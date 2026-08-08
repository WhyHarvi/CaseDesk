ALTER TABLE "cases"
    ADD COLUMN "creation_idempotency_key" TEXT;

CREATE UNIQUE INDEX "cases_agency_id_creation_idempotency_key_key"
    ON "cases"("agency_id", "creation_idempotency_key");
