ALTER TABLE "clients" ADD COLUMN "marital_status" TEXT;

-- Preserve the most recently saved applicant-profile answer as the
-- client-level value. Runtime synchronization keeps every case aligned
-- after this one-time backfill.
UPDATE "clients" AS client
SET "marital_status" = latest."marital_status"
FROM (
  SELECT DISTINCT ON ("client_id")
    "client_id",
    CASE LOWER(NULLIF(BTRIM("form_data"->'profile'->>'maritalStatus'), ''))
      WHEN 'annulled' THEN 'Annulled Marriage'
      WHEN 'annulled marriage' THEN 'Annulled Marriage'
      WHEN 'common law' THEN 'Common-Law'
      WHEN 'common-law' THEN 'Common-Law'
      WHEN 'divorced' THEN 'Divorced / Separated'
      WHEN 'divorced / separated' THEN 'Divorced / Separated'
      WHEN 'separated' THEN 'Divorced / Separated'
      WHEN 'legally separated' THEN 'Legally Separated'
      WHEN 'married' THEN 'Married'
      WHEN 'never married' THEN 'Never Married / Single'
      WHEN 'never married / single' THEN 'Never Married / Single'
      WHEN 'single' THEN 'Never Married / Single'
      WHEN 'widowed' THEN 'Widowed'
      ELSE NULL
    END AS "marital_status"
  FROM "case_assessments"
  WHERE LOWER(NULLIF(BTRIM("form_data"->'profile'->>'maritalStatus'), '')) IN (
    'annulled',
    'annulled marriage',
    'common law',
    'common-law',
    'divorced',
    'divorced / separated',
    'separated',
    'legally separated',
    'married',
    'never married',
    'never married / single',
    'single',
    'widowed'
  )
  ORDER BY "client_id", "updated_at" DESC
) AS latest
WHERE client."id" = latest."client_id";

UPDATE "case_assessments" AS assessment
SET "form_data" = JSONB_SET(
  COALESCE(assessment."form_data", '{}'::jsonb),
  '{profile}',
  COALESCE(assessment."form_data"->'profile', '{}'::jsonb)
    || JSONB_BUILD_OBJECT('maritalStatus', client."marital_status"),
  TRUE
)
FROM "clients" AS client
WHERE assessment."client_id" = client."id"
  AND assessment."agency_id" = client."agency_id"
  AND client."marital_status" IS NOT NULL;
