ALTER TABLE "booking_payment_holds"
    ALTER COLUMN "guest_email" DROP NOT NULL,
    ALTER COLUMN "guest_email_normalized" DROP NOT NULL,
    ADD COLUMN "manual_payment_reference" TEXT,
    ADD COLUMN "payment_error" TEXT;
