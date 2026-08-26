ALTER TABLE "case_payment_installments"
ADD COLUMN "last_invoice_error" TEXT,
ADD COLUMN "last_invoice_attempted_at" TIMESTAMP(3);
