-- Idempotent manual cash movements. Nullable keeps every existing receipt
-- and refund unchanged while protecting withdrawal retries from duplicates.
ALTER TABLE "cash_transactions"
  ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "cash_transactions_agency_id_idempotency_key_key"
  ON "cash_transactions"("agency_id", "idempotency_key");
