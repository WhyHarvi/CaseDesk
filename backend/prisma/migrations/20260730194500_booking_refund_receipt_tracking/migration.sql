ALTER TABLE "booking_payment_holds"
  ADD COLUMN "qb_refund_receipt_id" TEXT;

-- Earlier builds already recorded the matched RefundReceipt ID in the
-- immutable activity trail. Preserve that linkage during rollout so the
-- first post-deploy sweep does not mislabel an already-synchronized refund
-- as unmatched.
UPDATE "booking_payment_holds" AS hold
SET "qb_refund_receipt_id" = activity."refund_receipt_id"
FROM (
  SELECT DISTINCT ON ("agency_id", "metadata"->>'refundReceiptId')
    "agency_id",
    "entity_id",
    "metadata"->>'refundReceiptId' AS "refund_receipt_id"
  FROM "activity_logs"
  WHERE "action" = 'appointment.payment_refunded'
    AND "entity_type" = 'bookingPaymentHold'
    AND COALESCE("metadata"->>'refundReceiptId', '') <> ''
  ORDER BY
    "agency_id",
    "metadata"->>'refundReceiptId',
    "created_at" DESC
) AS activity
WHERE hold."agency_id" = activity."agency_id"
  AND hold."id" = activity."entity_id"
  AND hold."status" = 'Refunded'
  AND hold."qb_refund_receipt_id" IS NULL;

CREATE UNIQUE INDEX "booking_payment_holds_agency_id_qb_refund_receipt_id_key"
  ON "booking_payment_holds"("agency_id", "qb_refund_receipt_id");
