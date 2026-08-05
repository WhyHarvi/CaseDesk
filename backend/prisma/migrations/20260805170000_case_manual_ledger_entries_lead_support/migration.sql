-- AlterTable: ledger entries can now attach to a Lead instead of requiring a Case+Client
ALTER TABLE "case_manual_ledger_entries"
    ADD COLUMN "lead_id" TEXT,
    ALTER COLUMN "case_id" DROP NOT NULL,
    ALTER COLUMN "client_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "case_manual_ledger_entries_agency_id_lead_id_idx" ON "case_manual_ledger_entries"("agency_id", "lead_id");

-- AddForeignKey
ALTER TABLE "case_manual_ledger_entries" ADD CONSTRAINT "case_manual_ledger_entries_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
