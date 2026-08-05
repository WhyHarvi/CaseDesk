-- CreateTable
CREATE TABLE "case_manual_ledger_entries" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount_owed" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "amount_paid" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Unpaid',
    "note" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "case_manual_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "case_manual_ledger_entries_agency_id_case_id_idx" ON "case_manual_ledger_entries"("agency_id", "case_id");

-- CreateIndex
CREATE INDEX "case_manual_ledger_entries_agency_id_client_id_idx" ON "case_manual_ledger_entries"("agency_id", "client_id");

-- AddForeignKey
ALTER TABLE "case_manual_ledger_entries" ADD CONSTRAINT "case_manual_ledger_entries_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_manual_ledger_entries" ADD CONSTRAINT "case_manual_ledger_entries_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_manual_ledger_entries" ADD CONSTRAINT "case_manual_ledger_entries_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_manual_ledger_entries" ADD CONSTRAINT "case_manual_ledger_entries_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
