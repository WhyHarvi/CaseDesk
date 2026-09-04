ALTER TABLE "clients"
  ADD COLUMN "secondary_phone" TEXT,
  ADD COLUMN "secondary_phone_normalized" TEXT;

ALTER TABLE "clients"
  ADD CONSTRAINT "clients_distinct_phone_numbers_check"
  CHECK (
    "secondary_phone_normalized" IS NULL
    OR "secondary_phone_normalized" IS DISTINCT FROM "phone_normalized"
  );

CREATE UNIQUE INDEX "clients_agency_id_secondary_phone_normalized_key"
  ON "clients"("agency_id", "secondary_phone_normalized");
