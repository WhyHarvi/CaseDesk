ALTER TABLE "cash_transactions" ADD COLUMN "custom_ledger_id" TEXT;

CREATE INDEX "cash_transactions_agency_id_custom_ledger_id_occurred_at_idx"
ON "cash_transactions"("agency_id", "custom_ledger_id", "occurred_at");

ALTER TABLE "cash_transactions"
ADD CONSTRAINT "cash_transactions_custom_ledger_id_fkey"
FOREIGN KEY ("custom_ledger_id") REFERENCES "agency_custom_payment_ledgers"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
