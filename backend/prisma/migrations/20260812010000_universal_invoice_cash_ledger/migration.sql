-- Make the CaseDesk invoice the durable customer-facing document. Existing
-- QuickBooks invoices keep their external identifiers; cash-only invoices can
-- now use the same invoice, line-item and tax structure without being sent to
-- QuickBooks.
ALTER TABLE "case_invoices"
  ADD COLUMN "invoice_number" TEXT,
  ADD COLUMN "accounting_provider" TEXT NOT NULL DEFAULT 'QuickBooks',
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'CAD',
  ADD COLUMN "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "subtotal_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "discount_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "tax_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "tax_rate_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN "agency_snapshot" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "client_snapshot" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "case_invoices"
  ALTER COLUMN "qb_invoice_id" DROP NOT NULL,
  ALTER COLUMN "qb_sync_token" DROP NOT NULL,
  ALTER COLUMN "last_synced_at" DROP NOT NULL;

WITH numbered AS (
  SELECT
    "id",
    "qb_invoice_number",
    ROW_NUMBER() OVER (
      PARTITION BY "agency_id", "qb_invoice_number"
      ORDER BY "created_at", "id"
    ) AS duplicate_number
  FROM "case_invoices"
)
UPDATE "case_invoices" AS invoice
SET
  "invoice_number" = CASE
    WHEN numbered."qb_invoice_number" IS NOT NULL AND numbered."duplicate_number" = 1
      THEN numbered."qb_invoice_number"
    ELSE 'LEGACY-' || UPPER(SUBSTRING(invoice."id" FROM 1 FOR 8))
  END,
  "issued_at" = invoice."created_at",
  "subtotal_amount" = invoice."amount"
FROM numbered
WHERE numbered."id" = invoice."id";

UPDATE "case_invoices" AS invoice
SET "agency_snapshot" = jsonb_strip_nulls(jsonb_build_object(
      'name', agency."name",
      'legalName', agency."legal_name",
      'email', agency."email",
      'phone', agency."phone",
      'address', agency."address",
      'city', agency."city",
      'province', agency."province",
      'postalCode', agency."postal_code",
      'country', agency."country",
      'logoUrl', agency."logo_url",
      'businessNumber', agency."business_number",
      'taxNumber', agency."tax_number"
    ))
FROM "agencies" AS agency
WHERE agency."id" = invoice."agency_id";

UPDATE "case_invoices" AS invoice
SET "client_snapshot" = jsonb_strip_nulls(jsonb_build_object(
      'clientNumber', client."client_number",
      'fullName', client."full_name",
      'email', client."email",
      'phone', client."phone",
      'address', client."address"
    ))
FROM "clients" AS client
WHERE client."id" = invoice."client_id";

ALTER TABLE "case_invoices" ALTER COLUMN "invoice_number" SET NOT NULL;
CREATE UNIQUE INDEX "case_invoices_agency_id_invoice_number_key"
  ON "case_invoices"("agency_id", "invoice_number");

CREATE TABLE "case_invoice_lines" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "invoice_id" TEXT NOT NULL,
  "fee_category" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "quantity" DECIMAL(10,2) NOT NULL DEFAULT 1,
  "unit_amount" DECIMAL(10,2) NOT NULL,
  "discount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "taxable" BOOLEAN NOT NULL DEFAULT false,
  "tax_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "tax_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "line_total" DECIMAL(10,2) NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "case_invoice_lines_pkey" PRIMARY KEY ("id")
);

INSERT INTO "case_invoice_lines" (
  "id", "agency_id", "invoice_id", "fee_category", "description",
  "quantity", "unit_amount", "discount", "taxable", "tax_rate",
  "tax_amount", "line_total", "sort_order"
)
SELECT
  gen_random_uuid()::text, "agency_id", "id", "payment_type", "description",
  1, "amount", 0, false, 0, 0, "amount", 0
FROM "case_invoices";

CREATE INDEX "case_invoice_lines_agency_id_invoice_id_sort_order_idx"
  ON "case_invoice_lines"("agency_id", "invoice_id", "sort_order");
ALTER TABLE "case_invoice_lines"
  ADD CONSTRAINT "case_invoice_lines_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "case_invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "case_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "cash_transactions" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "client_id" TEXT,
  "case_id" TEXT,
  "appointment_id" TEXT,
  "payment_approval_id" TEXT,
  "type" TEXT NOT NULL DEFAULT 'Payment',
  "amount" DECIMAL(10,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'CAD',
  "reference" TEXT,
  "occurred_at" DATE NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'Posted',
  "note" TEXT,
  "created_by_id" TEXT,
  "reversed_transaction_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "cash_transactions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cash_transactions_payment_approval_id_key" ON "cash_transactions"("payment_approval_id");
CREATE UNIQUE INDEX "cash_transactions_agency_id_reference_key" ON "cash_transactions"("agency_id", "reference");
CREATE INDEX "cash_transactions_agency_id_occurred_at_idx" ON "cash_transactions"("agency_id", "occurred_at");
CREATE INDEX "cash_transactions_client_id_occurred_at_idx" ON "cash_transactions"("client_id", "occurred_at");
CREATE INDEX "cash_transactions_case_id_occurred_at_idx" ON "cash_transactions"("case_id", "occurred_at");

ALTER TABLE "cash_transactions"
  ADD CONSTRAINT "cash_transactions_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "cash_transactions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "cash_transactions_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "cash_transactions_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "cash_transactions_payment_approval_id_fkey" FOREIGN KEY ("payment_approval_id") REFERENCES "payment_approvals"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "cash_transactions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "cash_transactions_reversed_transaction_id_fkey" FOREIGN KEY ("reversed_transaction_id") REFERENCES "cash_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "cash_allocations" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "transaction_id" TEXT NOT NULL,
  "invoice_id" TEXT NOT NULL,
  "amount" DECIMAL(10,2) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cash_allocations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cash_allocations_transaction_id_invoice_id_key" ON "cash_allocations"("transaction_id", "invoice_id");
CREATE INDEX "cash_allocations_agency_id_invoice_id_idx" ON "cash_allocations"("agency_id", "invoice_id");
ALTER TABLE "cash_allocations"
  ADD CONSTRAINT "cash_allocations_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "cash_allocations_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "cash_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "cash_allocations_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "case_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "invoice_refunds" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "invoice_id" TEXT NOT NULL,
  "amount" DECIMAL(10,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'CAD',
  "accounting_provider" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'Requested',
  "reason" TEXT,
  "qb_refund_receipt_id" TEXT,
  "cash_transaction_id" TEXT,
  "requested_by_id" TEXT,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "invoice_refunds_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invoice_refunds_cash_transaction_id_key" ON "invoice_refunds"("cash_transaction_id");
CREATE UNIQUE INDEX "invoice_refunds_agency_id_qb_refund_receipt_id_key" ON "invoice_refunds"("agency_id", "qb_refund_receipt_id");
CREATE INDEX "invoice_refunds_agency_id_status_created_at_idx" ON "invoice_refunds"("agency_id", "status", "created_at");
CREATE INDEX "invoice_refunds_invoice_id_created_at_idx" ON "invoice_refunds"("invoice_id", "created_at");
ALTER TABLE "invoice_refunds"
  ADD CONSTRAINT "invoice_refunds_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "invoice_refunds_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "case_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "invoice_refunds_cash_transaction_id_fkey" FOREIGN KEY ("cash_transaction_id") REFERENCES "cash_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "invoice_refunds_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "cash_reconciliations" (
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

CREATE UNIQUE INDEX "cash_reconciliations_agency_id_period_start_key" ON "cash_reconciliations"("agency_id", "period_start");
CREATE INDEX "cash_reconciliations_agency_id_closed_at_idx" ON "cash_reconciliations"("agency_id", "closed_at");
ALTER TABLE "cash_reconciliations"
  ADD CONSTRAINT "cash_reconciliations_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "cash_reconciliations_closed_by_id_fkey" FOREIGN KEY ("closed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing approved cash approvals are preserved as auditable cash ledger
-- transactions. References remain in the approval row because historical
-- data did not enforce uniqueness; new cash transactions do.
INSERT INTO "cash_transactions" (
  "id", "agency_id", "client_id", "case_id", "appointment_id",
  "payment_approval_id", "type", "amount", "occurred_at", "status",
  "note", "created_by_id", "created_at", "updated_at"
)
SELECT
  gen_random_uuid()::text, approval."agency_id", approval."client_id",
  approval."case_id", approval."appointment_id", approval."id", 'Payment',
  approval."amount", approval."payment_date", 'Posted',
  CONCAT_WS(' — ', approval."note", CASE WHEN approval."transaction_reference" IS NOT NULL THEN 'Legacy reference: ' || approval."transaction_reference" END),
  approval."reviewed_by_id", approval."created_at", approval."updated_at"
FROM "payment_approvals" AS approval
WHERE approval."status" = 'Approved' AND approval."method" = 'Cash'
ON CONFLICT ("payment_approval_id") DO NOTHING;

INSERT INTO "cash_allocations" ("id", "agency_id", "transaction_id", "invoice_id", "amount")
SELECT gen_random_uuid()::text, transaction."agency_id", transaction."id", approval."case_invoice_id", approval."amount"
FROM "cash_transactions" AS transaction
JOIN "payment_approvals" AS approval ON approval."id" = transaction."payment_approval_id"
WHERE approval."case_invoice_id" IS NOT NULL
ON CONFLICT ("transaction_id", "invoice_id") DO NOTHING;

ALTER TABLE "agency_quickbooks_settings"
  ADD COLUMN "taxable_tax_code_id" TEXT,
  ADD COLUMN "taxable_tax_code_name" TEXT;

ALTER TABLE "case_invoice_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cash_transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cash_allocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoice_refunds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cash_reconciliations" ENABLE ROW LEVEL SECURITY;

CREATE POLICY case_invoice_lines_staff ON "case_invoice_lines" FOR ALL TO authenticated
  USING ("agency_id" = current_agency_id() AND current_user_role() IN ('admin', 'consultant', 'accountant'))
  WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() IN ('admin', 'consultant', 'accountant'));
CREATE POLICY cash_transactions_staff ON "cash_transactions" FOR ALL TO authenticated
  USING ("agency_id" = current_agency_id() AND current_user_role() IN ('admin', 'accountant'))
  WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() IN ('admin', 'accountant'));
CREATE POLICY cash_allocations_staff ON "cash_allocations" FOR ALL TO authenticated
  USING ("agency_id" = current_agency_id() AND current_user_role() IN ('admin', 'accountant'))
  WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() IN ('admin', 'accountant'));
CREATE POLICY invoice_refunds_staff ON "invoice_refunds" FOR ALL TO authenticated
  USING ("agency_id" = current_agency_id() AND current_user_role() IN ('admin', 'accountant'))
  WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() IN ('admin', 'accountant'));
CREATE POLICY cash_reconciliations_staff ON "cash_reconciliations" FOR ALL TO authenticated
  USING ("agency_id" = current_agency_id() AND current_user_role() IN ('admin', 'accountant'))
  WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() IN ('admin', 'accountant'));
