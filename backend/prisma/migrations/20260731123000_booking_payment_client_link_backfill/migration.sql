UPDATE "booking_payment_holds" AS hold
SET "client_id" = appointment."client_id"
FROM "appointments" AS appointment
WHERE hold."appointment_id" = appointment."id"
  AND hold."client_id" IS NULL
  AND appointment."client_id" IS NOT NULL;

