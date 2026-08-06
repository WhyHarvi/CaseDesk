-- Follow-up audit trail and structured relationships.
ALTER TABLE "follow_ups"
  ADD COLUMN "document_id" TEXT,
  ADD COLUMN "case_invoice_id" TEXT,
  ADD COLUMN "created_by_id" TEXT,
  ADD COLUMN "completed_by_id" TEXT,
  ADD COLUMN "cancelled_by_id" TEXT,
  ADD COLUMN "completion_outcome" TEXT,
  ADD COLUMN "cancellation_reason" TEXT,
  ADD COLUMN "expires_at" TIMESTAMP(3);

-- Overdue is now a display/query state derived from Pending + due_date.
UPDATE "follow_ups"
SET "status" = 'Pending'
WHERE "status" = 'Overdue';

ALTER TABLE "follow_ups"
  ADD CONSTRAINT "follow_ups_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "client_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "follow_ups_case_invoice_id_fkey"
    FOREIGN KEY ("case_invoice_id") REFERENCES "case_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "follow_ups_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "follow_ups_completed_by_id_fkey"
    FOREIGN KEY ("completed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "follow_ups_cancelled_by_id_fkey"
    FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "follow_ups_document_id_idx" ON "follow_ups"("document_id");
CREATE INDEX "follow_ups_case_invoice_id_idx" ON "follow_ups"("case_invoice_id");
CREATE INDEX "follow_ups_created_by_id_idx" ON "follow_ups"("created_by_id");
CREATE INDEX "follow_ups_agency_id_status_due_date_idx" ON "follow_ups"("agency_id", "status", "due_date");
