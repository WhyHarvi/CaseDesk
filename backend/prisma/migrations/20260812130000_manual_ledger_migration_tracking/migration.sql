-- AlterTable
ALTER TABLE "case_manual_ledger_entries"
  ADD COLUMN "migrated_invoice_id" TEXT,
  ADD COLUMN "migrated_at" TIMESTAMP(3);

ALTER TABLE "case_manual_ledger_entries"
  ADD CONSTRAINT "case_manual_ledger_entries_migrated_invoice_id_fkey"
  FOREIGN KEY ("migrated_invoice_id") REFERENCES "case_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
