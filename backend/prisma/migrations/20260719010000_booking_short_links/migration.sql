ALTER TABLE "booking_settings" ADD COLUMN "public_slug" TEXT;

WITH normalized AS (
  SELECT
    bs.id,
    bs.public_token,
    COALESCE(
      NULLIF(
        LEFT(
          TRIM(BOTH '-' FROM REGEXP_REPLACE(LOWER(COALESCE(a.legal_name, a.name)), '[^a-z0-9]+', '-', 'g')),
          42
        ),
        ''
      ),
      'book'
    ) AS base_slug
  FROM "booking_settings" bs
  JOIN "agencies" a ON a.id = bs.agency_id
), ranked AS (
  SELECT *, COUNT(*) OVER (PARTITION BY base_slug) AS duplicate_count
  FROM normalized
)
UPDATE "booking_settings" bs
SET "public_slug" = CASE
  WHEN ranked.duplicate_count = 1 THEN ranked.base_slug
  ELSE ranked.base_slug || '-' || LEFT(REPLACE(ranked.public_token, '-', ''), 5)
END
FROM ranked
WHERE ranked.id = bs.id;

ALTER TABLE "booking_settings" ALTER COLUMN "public_slug" SET NOT NULL;
CREATE UNIQUE INDEX "booking_settings_public_slug_key" ON "booking_settings"("public_slug");
