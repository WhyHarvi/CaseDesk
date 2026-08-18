-- CreateTable
CREATE TABLE "case_invoice_credit_cursors" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "case_invoice_id" TEXT NOT NULL,
    "last_credited_balance" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "case_invoice_credit_cursors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incentive_ledger_entries" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "case_invoice_id" TEXT NOT NULL,
    "incentive_plan_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "attribution_kind" TEXT NOT NULL,
    "case_role_id" TEXT,
    "role_name_snapshot" TEXT NOT NULL,
    "share_percent_applied" DECIMAL(5,2) NOT NULL,
    "source_amount_collected" DECIMAL(10,2) NOT NULL,
    "credited_amount" DECIMAL(10,2) NOT NULL,
    "trigger_source" TEXT NOT NULL,
    "trigger_ref" TEXT,
    "credited_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incentive_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "case_invoice_credit_cursors_case_invoice_id_key" ON "case_invoice_credit_cursors"("case_invoice_id");

-- CreateIndex
CREATE INDEX "incentive_ledger_entries_agency_id_user_id_credited_at_idx" ON "incentive_ledger_entries"("agency_id", "user_id", "credited_at");

-- CreateIndex
CREATE INDEX "incentive_ledger_entries_agency_id_case_id_idx" ON "incentive_ledger_entries"("agency_id", "case_id");

-- CreateIndex
CREATE INDEX "incentive_ledger_entries_agency_id_case_invoice_id_idx" ON "incentive_ledger_entries"("agency_id", "case_invoice_id");

-- CreateIndex
CREATE INDEX "incentive_ledger_entries_agency_id_credited_at_idx" ON "incentive_ledger_entries"("agency_id", "credited_at");

-- AddForeignKey
ALTER TABLE "case_invoice_credit_cursors" ADD CONSTRAINT "case_invoice_credit_cursors_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_invoice_credit_cursors" ADD CONSTRAINT "case_invoice_credit_cursors_case_invoice_id_fkey" FOREIGN KEY ("case_invoice_id") REFERENCES "case_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_ledger_entries" ADD CONSTRAINT "incentive_ledger_entries_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_ledger_entries" ADD CONSTRAINT "incentive_ledger_entries_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_ledger_entries" ADD CONSTRAINT "incentive_ledger_entries_case_invoice_id_fkey" FOREIGN KEY ("case_invoice_id") REFERENCES "case_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_ledger_entries" ADD CONSTRAINT "incentive_ledger_entries_incentive_plan_id_fkey" FOREIGN KEY ("incentive_plan_id") REFERENCES "incentive_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_ledger_entries" ADD CONSTRAINT "incentive_ledger_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_ledger_entries" ADD CONSTRAINT "incentive_ledger_entries_case_role_id_fkey" FOREIGN KEY ("case_role_id") REFERENCES "agency_case_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Mandatory backfill: seed a cursor for every existing CaseInvoice at its
-- CURRENT balance, before the crediting engine's hook points go live. Without
-- this, the first time any hook observes an existing invoice, it would read
-- "no cursor yet" and treat the invoice's entire already-collected history as
-- a brand-new collection, causing a one-time incorrect mass-credit spike
-- across every agency with existing partially-paid invoices. New invoices
-- created after this migration get their cursor lazily on first observation
-- (see incentiveCreditingService.creditCaseInvoiceCollection), which is
-- correct because a brand-new invoice's balance equals its amount — nothing
-- has been collected on it yet.
INSERT INTO "case_invoice_credit_cursors" ("id", "agency_id", "case_invoice_id", "last_credited_balance", "created_at", "updated_at")
SELECT gen_random_uuid()::text, "agency_id", "id", "balance", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "case_invoices"
ON CONFLICT ("case_invoice_id") DO NOTHING;
