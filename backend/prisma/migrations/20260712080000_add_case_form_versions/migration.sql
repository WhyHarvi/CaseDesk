CREATE TYPE "FormVersionStatus" AS ENUM ('Unverified', 'Current', 'Update Available', 'Unsupported Revision', 'Source Unavailable', 'Portal Only');
CREATE TYPE "CaseFormVersionSource" AS ENUM ('Official Import', 'Custom Upload', 'Restored');

ALTER TABLE "case_forms"
  ADD COLUMN "language" TEXT NOT NULL DEFAULT 'English',
  ADD COLUMN "file_hash" TEXT,
  ADD COLUMN "source_downloaded_at" TIMESTAMP(3),
  ADD COLUMN "mapping_version" TEXT,
  ADD COLUMN "version_status" "FormVersionStatus" NOT NULL DEFAULT 'Unverified',
  ADD COLUMN "available_revision" TEXT,
  ADD COLUMN "last_version_checked_at" TIMESTAMP(3);

CREATE TABLE "case_form_versions" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "case_form_id" TEXT NOT NULL,
  "version_number" INTEGER NOT NULL,
  "source" "CaseFormVersionSource" NOT NULL,
  "language" TEXT NOT NULL DEFAULT 'English',
  "source_revision" TEXT,
  "file_hash" TEXT NOT NULL,
  "official_url" TEXT,
  "mapping_version" TEXT,
  "storage_key" TEXT NOT NULL,
  "original_filename" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "file_size" INTEGER NOT NULL,
  "source_downloaded_at" TIMESTAMP(3),
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "case_form_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "case_form_versions_case_form_id_version_number_key" ON "case_form_versions"("case_form_id", "version_number");
CREATE INDEX "case_form_versions_agency_id_idx" ON "case_form_versions"("agency_id");
CREATE INDEX "case_form_versions_case_form_id_idx" ON "case_form_versions"("case_form_id");
CREATE INDEX "case_form_versions_created_by_id_idx" ON "case_form_versions"("created_by_id");

ALTER TABLE "case_form_versions" ADD CONSTRAINT "case_form_versions_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "case_form_versions" ADD CONSTRAINT "case_form_versions_case_form_id_fkey" FOREIGN KEY ("case_form_id") REFERENCES "case_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "case_form_versions" ADD CONSTRAINT "case_form_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
