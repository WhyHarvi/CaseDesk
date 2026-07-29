ALTER TABLE "appointments"
  ADD COLUMN "location_id" TEXT;

ALTER TABLE "booking_payment_holds"
  ADD COLUMN "offer_hold_id" TEXT;

ALTER TABLE "booking_payment_holds"
  ADD CONSTRAINT "booking_payment_holds_offer_hold_id_key" UNIQUE ("offer_hold_id");

ALTER TABLE "booking_payment_holds"
  ADD CONSTRAINT "booking_payment_holds_offer_hold_id_fkey"
  FOREIGN KEY ("offer_hold_id") REFERENCES "booking_slot_holds"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
