ALTER TYPE "DocumentStatus" RENAME TO "DocumentStatus_old";

CREATE TYPE "DocumentStatus" AS ENUM (
  'Requested',
  'Uploaded',
  'Under Review',
  'Changes Requested',
  'Approved',
  'Finalized',
  'Not Required'
);

ALTER TABLE "client_documents"
ALTER COLUMN "status" TYPE "DocumentStatus"
USING (
  CASE "status"::text
    WHEN 'Pending' THEN 'Requested'
    WHEN 'Missing' THEN 'Requested'
    WHEN 'Received' THEN 'Uploaded'
    WHEN 'Reviewed' THEN 'Finalized'
    WHEN 'Not Required' THEN 'Not Required'
  END
)::"DocumentStatus";

DROP TYPE "DocumentStatus_old";
