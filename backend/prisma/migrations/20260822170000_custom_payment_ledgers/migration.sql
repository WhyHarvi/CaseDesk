CREATE TABLE "agency_custom_payment_ledgers" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "color" TEXT NOT NULL DEFAULT '#6366F1',
  "case_types" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "payment_methods" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "agency_custom_payment_ledgers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agency_custom_payment_ledgers_agency_id_name_key" ON "agency_custom_payment_ledgers"("agency_id", "name");
CREATE INDEX "agency_custom_payment_ledgers_agency_id_is_active_idx" ON "agency_custom_payment_ledgers"("agency_id", "is_active");
ALTER TABLE "agency_custom_payment_ledgers" ADD CONSTRAINT "agency_custom_payment_ledgers_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agency_custom_payment_ledgers" ADD CONSTRAINT "agency_custom_payment_ledgers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "case_invoices" ADD COLUMN "custom_ledger_id" TEXT;
CREATE INDEX "case_invoices_agency_id_custom_ledger_id_idx" ON "case_invoices"("agency_id", "custom_ledger_id");
ALTER TABLE "case_invoices" ADD CONSTRAINT "case_invoices_custom_ledger_id_fkey" FOREIGN KEY ("custom_ledger_id") REFERENCES "agency_custom_payment_ledgers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payment_approvals" ADD COLUMN "custom_ledger_id" TEXT;
CREATE INDEX "payment_approvals_agency_id_custom_ledger_id_payment_date_idx" ON "payment_approvals"("agency_id", "custom_ledger_id", "payment_date");
ALTER TABLE "payment_approvals" ADD CONSTRAINT "payment_approvals_custom_ledger_id_fkey" FOREIGN KEY ("custom_ledger_id") REFERENCES "agency_custom_payment_ledgers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
