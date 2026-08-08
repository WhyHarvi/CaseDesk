ALTER TABLE "clients"
    ADD COLUMN "creation_idempotency_key" TEXT;

CREATE UNIQUE INDEX "clients_agency_id_creation_idempotency_key_key"
    ON "clients"("agency_id", "creation_idempotency_key");
