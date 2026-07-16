CREATE TYPE "FormCopyType" AS ENUM ('Original', 'Working', 'Filled', 'Client Signed', 'Finalized');
ALTER TYPE "CaseFormVersionSource" ADD VALUE 'Browser Save';

ALTER TABLE "case_forms" ADD COLUMN "current_copy_type" "FormCopyType" NOT NULL DEFAULT 'Original';
ALTER TABLE "case_form_versions" ADD COLUMN "copy_type" "FormCopyType" NOT NULL DEFAULT 'Working';

UPDATE "case_forms"
SET "current_copy_type" = CASE
  WHEN "source_downloaded_at" IS NOT NULL THEN 'Original'::"FormCopyType"
  WHEN "storage_key" IS NOT NULL THEN 'Working'::"FormCopyType"
  ELSE 'Original'::"FormCopyType"
END;

UPDATE "case_form_versions"
SET "copy_type" = CASE
  WHEN "source" = 'Official Import'::"CaseFormVersionSource" THEN 'Original'::"FormCopyType"
  ELSE 'Working'::"FormCopyType"
END;
