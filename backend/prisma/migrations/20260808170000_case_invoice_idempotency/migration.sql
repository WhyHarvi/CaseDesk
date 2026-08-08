ALTER TABLE "case_invoices"
    ADD COLUMN "creation_idempotency_key" TEXT,
    ADD COLUMN "last_payment_idempotency_key" TEXT;

CREATE UNIQUE INDEX "case_invoices_agency_id_creation_idempotency_key_key"
    ON "case_invoices"("agency_id", "creation_idempotency_key");

CREATE UNIQUE INDEX "case_invoices_agency_id_last_payment_idempotency_key_key"
    ON "case_invoices"("agency_id", "last_payment_idempotency_key");
