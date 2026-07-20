CREATE TABLE "case_invoices" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "case_id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "payment_type" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "qb_invoice_id" TEXT NOT NULL,
  "qb_invoice_number" TEXT,
  "qb_sync_token" TEXT NOT NULL,
  "amount" DECIMAL(10,2) NOT NULL,
  "balance" DECIMAL(10,2) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'Open',
  "due_date" TIMESTAMP(3),
  "created_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "last_synced_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "case_invoices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "case_invoices_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "case_invoices_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "case_invoices_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "case_invoices_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "case_invoices_agency_id_qb_invoice_id_key" ON "case_invoices"("agency_id", "qb_invoice_id");
CREATE INDEX "case_invoices_agency_id_case_id_idx" ON "case_invoices"("agency_id", "case_id");
CREATE INDEX "case_invoices_agency_id_client_id_idx" ON "case_invoices"("agency_id", "client_id");

ALTER TABLE "case_invoices" ENABLE ROW LEVEL SECURITY;
CREATE POLICY case_invoices_staff ON "case_invoices" FOR ALL TO authenticated
  USING ("agency_id" = current_agency_id() AND current_user_role() IN ('admin', 'consultant'))
  WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() IN ('admin', 'consultant'));
