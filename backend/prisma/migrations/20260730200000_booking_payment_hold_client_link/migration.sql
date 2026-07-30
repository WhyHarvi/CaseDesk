ALTER TABLE "booking_payment_holds" ADD COLUMN "client_id" TEXT;

CREATE INDEX "booking_payment_holds_client_id_idx" ON "booking_payment_holds"("client_id");

ALTER TABLE "booking_payment_holds"
  ADD CONSTRAINT "booking_payment_holds_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
