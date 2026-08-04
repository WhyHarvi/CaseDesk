ALTER TABLE "booking_message_deliveries"
  ALTER COLUMN "appointment_id" DROP NOT NULL,
  ADD COLUMN "payment_hold_id" TEXT;

ALTER TABLE "booking_message_deliveries"
  ADD CONSTRAINT "booking_message_deliveries_payment_hold_id_fkey"
  FOREIGN KEY ("payment_hold_id") REFERENCES "booking_payment_holds"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "booking_message_deliveries_payment_hold_id_created_at_idx"
  ON "booking_message_deliveries"("payment_hold_id", "created_at");

ALTER TABLE "booking_message_deliveries"
  ADD CONSTRAINT "booking_message_deliveries_parent_check"
  CHECK ("appointment_id" IS NOT NULL OR "payment_hold_id" IS NOT NULL);
