ALTER TABLE "case_invoices"
    ADD COLUMN "last_payment_method" TEXT,
    ADD COLUMN "last_payment_reference" TEXT,
    ADD COLUMN "last_payment_at" TIMESTAMP(3),
    ADD COLUMN "last_qb_payment_id" TEXT;
