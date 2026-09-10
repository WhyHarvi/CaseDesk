ALTER TABLE "case_invoices"
  ADD COLUMN "client_payment_method" TEXT,
  ADD COLUMN "client_payment_reference" TEXT,
  ADD COLUMN "client_payment_proof_storage_key" TEXT,
  ADD COLUMN "client_payment_proof_mime_type" TEXT,
  ADD COLUMN "client_payment_proof_filename" TEXT,
  ADD COLUMN "client_payment_submitted_at" TIMESTAMP(3);
