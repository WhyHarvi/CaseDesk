CREATE TABLE "case_invoice_incentive_snapshots" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "case_invoice_id" TEXT NOT NULL,
    "incentive_plan_id" TEXT,
    "plan_name" TEXT,
    "plan_version" INTEGER,
    "formula_type" TEXT,
    "flat_amount" DECIMAL(10,2),
    "percent_rate" DECIMAL(5,2),
    "tiers" JSONB NOT NULL,
    "recipients" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_invoice_incentive_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "case_invoice_incentive_snapshots_case_invoice_id_key"
ON "case_invoice_incentive_snapshots"("case_invoice_id");
CREATE INDEX "case_invoice_incentive_snapshots_agency_id_idx"
ON "case_invoice_incentive_snapshots"("agency_id");

ALTER TABLE "case_invoice_incentive_snapshots"
ADD CONSTRAINT "case_invoice_incentive_snapshots_agency_id_fkey"
FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "case_invoice_incentive_snapshots"
ADD CONSTRAINT "case_invoice_incentive_snapshots_case_invoice_id_fkey"
FOREIGN KEY ("case_invoice_id") REFERENCES "case_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "case_invoice_incentive_snapshots"
ADD CONSTRAINT "case_invoice_incentive_snapshots_incentive_plan_id_fkey"
FOREIGN KEY ("incentive_plan_id") REFERENCES "incentive_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "incentive_ledger_entries"
ADD COLUMN "entry_type" TEXT NOT NULL DEFAULT 'CREDIT',
ADD COLUMN "reverses_entry_id" TEXT;

CREATE INDEX "incentive_ledger_entries_reverses_entry_id_idx"
ON "incentive_ledger_entries"("reverses_entry_id");
ALTER TABLE "incentive_ledger_entries"
ADD CONSTRAINT "incentive_ledger_entries_reverses_entry_id_fkey"
FOREIGN KEY ("reverses_entry_id") REFERENCES "incentive_ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing invoices retain their current cursor baseline. Their historical
-- team cannot be reconstructed safely, so snapshots are created only for new
-- invoices; legacy invoices are explicitly handled by the service fallback.
