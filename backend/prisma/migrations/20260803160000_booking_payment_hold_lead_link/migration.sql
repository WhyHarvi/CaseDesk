ALTER TABLE "booking_payment_holds" ADD COLUMN "lead_id" TEXT;

CREATE INDEX "booking_payment_holds_lead_id_idx" ON "booking_payment_holds"("lead_id");

ALTER TABLE "booking_payment_holds"
  ADD CONSTRAINT "booking_payment_holds_lead_id_fkey"
  FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
