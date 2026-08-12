-- Recreates the "cash_reconciliations" table, which was cleanly missing from
-- the database despite the 20260812010000_universal_invoice_cash_ledger
-- migration being recorded as fully applied (the other four tables it
-- created — case_invoice_lines, cash_transactions, cash_allocations,
-- invoice_refunds — and its case_invoices column changes are all present).
-- The table was evidently dropped separately after the fact, outside of any
-- migration. This recreates it verbatim from the original migration file so
-- Prisma Client's existing CashReconciliation model works again, without
-- touching the already-applied migration record.
--
-- Every statement here is written to be safe to re-run (IF NOT EXISTS /
-- DROP ... IF EXISTS before CREATE), in case this needs to run again in
-- another environment where the table was never dropped in the first place.

CREATE TABLE IF NOT EXISTS "cash_reconciliations" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "period_start" TIMESTAMP(3) NOT NULL,
  "period_end" TIMESTAMP(3) NOT NULL,
  "expected_amount" DECIMAL(10,2) NOT NULL,
  "counted_amount" DECIMAL(10,2) NOT NULL,
  "variance_amount" DECIMAL(10,2) NOT NULL,
  "receipt_count" INTEGER NOT NULL DEFAULT 0,
  "refund_count" INTEGER NOT NULL DEFAULT 0,
  "note" TEXT,
  "status" TEXT NOT NULL DEFAULT 'Closed',
  "closed_by_id" TEXT,
  "closed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cash_reconciliations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "cash_reconciliations_agency_id_period_start_key" ON "cash_reconciliations"("agency_id", "period_start");
CREATE INDEX IF NOT EXISTS "cash_reconciliations_agency_id_closed_at_idx" ON "cash_reconciliations"("agency_id", "closed_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cash_reconciliations_agency_id_fkey'
  ) THEN
    ALTER TABLE "cash_reconciliations"
      ADD CONSTRAINT "cash_reconciliations_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cash_reconciliations_closed_by_id_fkey'
  ) THEN
    ALTER TABLE "cash_reconciliations"
      ADD CONSTRAINT "cash_reconciliations_closed_by_id_fkey" FOREIGN KEY ("closed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "cash_reconciliations" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cash_reconciliations_staff ON "cash_reconciliations";
CREATE POLICY cash_reconciliations_staff ON "cash_reconciliations" FOR ALL TO authenticated
  USING ("agency_id" = current_agency_id() AND current_user_role() IN ('admin', 'accountant'))
  WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() IN ('admin', 'accountant'));
