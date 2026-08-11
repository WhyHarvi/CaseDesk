ALTER TABLE "case_payment_schedules"
ADD COLUMN "discount_amount" DECIMAL(10,2) NOT NULL DEFAULT 0;

ALTER TABLE "case_payment_installments"
ADD COLUMN "discount_amount" DECIMAL(10,2) NOT NULL DEFAULT 0;
