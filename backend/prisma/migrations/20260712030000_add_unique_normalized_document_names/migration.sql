ALTER TABLE "client_documents"
ADD COLUMN "normalized_name" TEXT;

UPDATE "client_documents"
SET "normalized_name" = btrim(
  regexp_replace(
    regexp_replace(lower(replace("document_name", '&', ' and ')), '[^a-z0-9]+', ' ', 'g'),
    '\s+', ' ', 'g'
  )
)
WHERE "visibility" = 'Client';

UPDATE "client_documents" SET "normalized_name" = regexp_replace("normalized_name", '\ycertificates\y', 'certificate', 'g') WHERE "normalized_name" IS NOT NULL;
UPDATE "client_documents" SET "normalized_name" = regexp_replace("normalized_name", '\ycopies\y', 'copy', 'g') WHERE "normalized_name" IS NOT NULL;
UPDATE "client_documents" SET "normalized_name" = regexp_replace("normalized_name", '\ydegrees\y', 'degree', 'g') WHERE "normalized_name" IS NOT NULL;
UPDATE "client_documents" SET "normalized_name" = regexp_replace("normalized_name", '\ydiplomas\y', 'diploma', 'g') WHERE "normalized_name" IS NOT NULL;
UPDATE "client_documents" SET "normalized_name" = regexp_replace("normalized_name", '\ydocuments\y', 'document', 'g') WHERE "normalized_name" IS NOT NULL;
UPDATE "client_documents" SET "normalized_name" = regexp_replace("normalized_name", '\yfees\y', 'fee', 'g') WHERE "normalized_name" IS NOT NULL;
UPDATE "client_documents" SET "normalized_name" = regexp_replace("normalized_name", '\yforms\y', 'form', 'g') WHERE "normalized_name" IS NOT NULL;
UPDATE "client_documents" SET "normalized_name" = regexp_replace("normalized_name", '\yletters\y', 'letter', 'g') WHERE "normalized_name" IS NOT NULL;
UPDATE "client_documents" SET "normalized_name" = regexp_replace("normalized_name", '\ypages\y', 'page', 'g') WHERE "normalized_name" IS NOT NULL;
UPDATE "client_documents" SET "normalized_name" = regexp_replace("normalized_name", '\ypassports\y', 'passport', 'g') WHERE "normalized_name" IS NOT NULL;
UPDATE "client_documents" SET "normalized_name" = regexp_replace("normalized_name", '\ypermits\y', 'permit', 'g') WHERE "normalized_name" IS NOT NULL;
UPDATE "client_documents" SET "normalized_name" = regexp_replace("normalized_name", '\yphotos\y', 'photo', 'g') WHERE "normalized_name" IS NOT NULL;
UPDATE "client_documents" SET "normalized_name" = regexp_replace("normalized_name", '\yreceipts\y', 'receipt', 'g') WHERE "normalized_name" IS NOT NULL;
UPDATE "client_documents" SET "normalized_name" = regexp_replace("normalized_name", '\yrecords\y', 'record', 'g') WHERE "normalized_name" IS NOT NULL;
UPDATE "client_documents" SET "normalized_name" = regexp_replace("normalized_name", '\yresults\y', 'result', 'g') WHERE "normalized_name" IS NOT NULL;
UPDATE "client_documents" SET "normalized_name" = regexp_replace("normalized_name", '\ystatements\y', 'statement', 'g') WHERE "normalized_name" IS NOT NULL;
UPDATE "client_documents" SET "normalized_name" = regexp_replace("normalized_name", '\ytranscripts\y', 'transcript', 'g') WHERE "normalized_name" IS NOT NULL;
UPDATE "client_documents" SET "normalized_name" = regexp_replace("normalized_name", '\ytranslations\y', 'translation', 'g') WHERE "normalized_name" IS NOT NULL;
UPDATE "client_documents" SET "normalized_name" = regexp_replace("normalized_name", '\yvisas\y', 'visa', 'g') WHERE "normalized_name" IS NOT NULL;

UPDATE "client_documents"
SET "normalized_name" = 'passport identity page'
WHERE "normalized_name" IN (
  'passport', 'passport bio page', 'passport biographical page',
  'passport identity page', 'passport information page',
  'passport or travel document', 'passport or travel document bio page',
  'valid passport bio page', 'valid passport information page'
);

UPDATE "client_documents"
SET "normalized_name" = 'application fee payment receipt'
WHERE "normalized_name" IN (
  'application fee payment receipt', 'payment receipt',
  'proof of application fee payment', 'proof of payment of application fee',
  'proof of payment receipt'
);

WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "case_id", "normalized_name"
      ORDER BY
        CASE "status"::text
          WHEN 'Reviewed' THEN 5
          WHEN 'Received' THEN 4
          WHEN 'Pending' THEN 3
          WHEN 'Missing' THEN 2
          ELSE 1
        END DESC,
        ("storage_key" IS NOT NULL) DESC,
        "updated_at" DESC,
        "created_at" DESC
    ) AS duplicate_rank
  FROM "client_documents"
  WHERE "case_id" IS NOT NULL AND "normalized_name" IS NOT NULL
)
DELETE FROM "client_documents"
WHERE "id" IN (SELECT "id" FROM ranked WHERE duplicate_rank > 1);

CREATE UNIQUE INDEX "client_documents_case_id_normalized_name_key"
ON "client_documents"("case_id", "normalized_name");
