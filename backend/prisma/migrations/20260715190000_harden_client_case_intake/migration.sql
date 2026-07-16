ALTER TABLE "clients"
  ADD COLUMN "phone_normalized" TEXT,
  ADD COLUMN "email_normalized" TEXT;

WITH normalized AS (
  SELECT
    "id",
    CASE
      WHEN "email" IS NULL OR BTRIM("email") = '' THEN NULL
      ELSE LOWER(BTRIM("email"))
    END AS email_value,
    CASE
      WHEN "phone" IS NULL OR REGEXP_REPLACE("phone", '[^0-9]', '', 'g') = '' THEN NULL
      WHEN LENGTH(REGEXP_REPLACE("phone", '[^0-9]', '', 'g')) = 10
        THEN '+1' || REGEXP_REPLACE("phone", '[^0-9]', '', 'g')
      ELSE '+' || REGEXP_REPLACE("phone", '[^0-9]', '', 'g')
    END AS phone_value
  FROM "clients"
), ranked AS (
  SELECT
    "id",
    email_value,
    phone_value,
    ROW_NUMBER() OVER (PARTITION BY "agency_id", email_value ORDER BY "created_at", "id") AS email_rank,
    ROW_NUMBER() OVER (PARTITION BY "agency_id", phone_value ORDER BY "created_at", "id") AS phone_rank
  FROM normalized
  JOIN "clients" USING ("id")
)
UPDATE "clients" AS client
SET
  "email_normalized" = CASE WHEN ranked.email_value IS NOT NULL AND ranked.email_rank = 1 THEN ranked.email_value END,
  "phone_normalized" = CASE WHEN ranked.phone_value IS NOT NULL AND ranked.phone_rank = 1 THEN ranked.phone_value END
FROM ranked
WHERE ranked."id" = client."id";

CREATE UNIQUE INDEX "clients_agency_id_phone_normalized_key"
  ON "clients"("agency_id", "phone_normalized");
CREATE UNIQUE INDEX "clients_agency_id_email_normalized_key"
  ON "clients"("agency_id", "email_normalized");

ALTER TABLE "cases" ADD COLUMN "priority" TEXT NOT NULL DEFAULT 'Normal';

UPDATE "cases"
SET "status" = 'Open'
WHERE "status" NOT IN ('Open', 'Active', 'On Hold', 'Completed', 'Closed', 'Cancelled', 'Inactive');

UPDATE "cases"
SET "stage" = 'Lead'
WHERE "stage" NOT IN ('Lead', 'Consultation', 'Retainer Pending', 'Documents Pending', 'Reviewing Documents', 'Application Preparing', 'Submitted', 'Decision Received', 'Closed');

ALTER TYPE "FollowUpStatus" ADD VALUE IF NOT EXISTS 'Cancelled';
