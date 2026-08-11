CREATE TABLE "payment_approvals" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "client_id" TEXT,
  "case_id" TEXT,
  "appointment_id" TEXT,
  "case_invoice_id" TEXT,
  "payment_id" TEXT,
  "entry_type" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "amount" DECIMAL(10,2) NOT NULL,
  "charge_amount" DECIMAL(10,2),
  "payment_type" TEXT,
  "description" TEXT,
  "transaction_reference" TEXT,
  "payment_date" DATE NOT NULL,
  "note" TEXT,
  "status" TEXT NOT NULL DEFAULT 'Pending',
  "source_role" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "submitted_by_id" TEXT NOT NULL,
  "reviewed_by_id" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "rejection_reason" TEXT,
  "qb_payment_id" TEXT,
  "processing_error" TEXT,
  "result" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_approvals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_approvals_agency_id_idempotency_key_key" ON "payment_approvals"("agency_id", "idempotency_key");
CREATE INDEX "payment_approvals_agency_id_status_created_at_idx" ON "payment_approvals"("agency_id", "status", "created_at");
CREATE INDEX "payment_approvals_client_id_created_at_idx" ON "payment_approvals"("client_id", "created_at");
CREATE INDEX "payment_approvals_case_id_created_at_idx" ON "payment_approvals"("case_id", "created_at");
CREATE INDEX "payment_approvals_appointment_id_created_at_idx" ON "payment_approvals"("appointment_id", "created_at");
CREATE INDEX "payment_approvals_case_invoice_id_created_at_idx" ON "payment_approvals"("case_invoice_id", "created_at");

ALTER TABLE "payment_approvals" ADD CONSTRAINT "payment_approvals_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_approvals" ADD CONSTRAINT "payment_approvals_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payment_approvals" ADD CONSTRAINT "payment_approvals_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payment_approvals" ADD CONSTRAINT "payment_approvals_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payment_approvals" ADD CONSTRAINT "payment_approvals_case_invoice_id_fkey" FOREIGN KEY ("case_invoice_id") REFERENCES "case_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payment_approvals" ADD CONSTRAINT "payment_approvals_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payment_approvals" ADD CONSTRAINT "payment_approvals_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_approvals" ADD CONSTRAINT "payment_approvals_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
