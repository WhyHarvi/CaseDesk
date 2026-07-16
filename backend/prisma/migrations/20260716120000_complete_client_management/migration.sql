CREATE TABLE "agency_client_sequences" (
  "agency_id" TEXT NOT NULL,
  "next_value" INTEGER NOT NULL DEFAULT 1,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "agency_client_sequences_pkey" PRIMARY KEY ("agency_id"),
  CONSTRAINT "agency_client_sequences_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "clients"
  ADD COLUMN "client_number" TEXT,
  ADD COLUMN "preferred_language" TEXT,
  ADD COLUMN "identification_type" TEXT,
  ADD COLUMN "identification_number" TEXT,
  ADD COLUMN "identification_country" TEXT,
  ADD COLUMN "identification_expiry_date" TIMESTAMP(3),
  ADD COLUMN "archived_at" TIMESTAMP(3);

WITH numbered AS (
  SELECT "id", "agency_id", ROW_NUMBER() OVER (PARTITION BY "agency_id" ORDER BY "created_at", "id") AS sequence_value
  FROM "clients"
)
UPDATE "clients" AS client
SET "client_number" = 'CL-' || EXTRACT(YEAR FROM client."created_at")::TEXT || '-' || LPAD(numbered.sequence_value::TEXT, 6, '0')
FROM numbered
WHERE numbered."id" = client."id";

INSERT INTO "agency_client_sequences" ("agency_id", "next_value", "updated_at")
SELECT "agency_id", COUNT(*) + 1, CURRENT_TIMESTAMP
FROM "clients"
GROUP BY "agency_id";

ALTER TABLE "clients" ALTER COLUMN "client_number" SET NOT NULL;
CREATE UNIQUE INDEX "clients_agency_id_client_number_key" ON "clients"("agency_id", "client_number");
CREATE INDEX "clients_agency_id_archived_at_idx" ON "clients"("agency_id", "archived_at");

ALTER TABLE "agency_client_sequences" ENABLE ROW LEVEL SECURITY;
CREATE POLICY client_sequence_staff ON "agency_client_sequences" FOR ALL TO authenticated
  USING ("agency_id" = current_agency_id() AND current_user_role() IN ('admin', 'consultant'))
  WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() IN ('admin', 'consultant'));
