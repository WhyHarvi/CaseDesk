ALTER TABLE "booking_payment_holds" ALTER COLUMN "qb_customer_id" DROP NOT NULL;
ALTER TABLE "booking_payment_holds" ALTER COLUMN "qb_invoice_id" DROP NOT NULL;
ALTER TABLE "booking_payment_holds" ALTER COLUMN "qb_sync_token" DROP NOT NULL;
