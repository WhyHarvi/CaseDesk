CREATE TYPE "FormStatus" AS ENUM ('Assigned', 'In Progress', 'Ready for Review', 'Changes Requested', 'Approved', 'Finalized', 'Not Required');
CREATE TYPE "FormSource" AS ENUM ('Catalog', 'Custom');
CREATE TYPE "FormRequirement" AS ENUM ('Required', 'Conditional', 'Optional');

CREATE TABLE "case_forms" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "case_id" TEXT NOT NULL,
  "catalog_id" TEXT,
  "form_number" TEXT,
  "title" TEXT NOT NULL,
  "normalized_name" TEXT NOT NULL,
  "source" "FormSource" NOT NULL DEFAULT 'Custom',
  "requirement" "FormRequirement" NOT NULL DEFAULT 'Required',
  "selection_reason" TEXT,
  "official_url" TEXT,
  "source_revision" TEXT,
  "status" "FormStatus" NOT NULL DEFAULT 'Assigned',
  "storage_key" TEXT,
  "original_filename" TEXT,
  "mime_type" TEXT,
  "file_size" INTEGER,
  "uploaded_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "case_forms_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "case_forms_case_id_normalized_name_key" ON "case_forms"("case_id", "normalized_name");
CREATE INDEX "case_forms_agency_id_idx" ON "case_forms"("agency_id");
CREATE INDEX "case_forms_client_id_idx" ON "case_forms"("client_id");
CREATE INDEX "case_forms_case_id_idx" ON "case_forms"("case_id");
CREATE INDEX "case_forms_uploaded_by_id_idx" ON "case_forms"("uploaded_by_id");

ALTER TABLE "case_forms" ADD CONSTRAINT "case_forms_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "case_forms" ADD CONSTRAINT "case_forms_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "case_forms" ADD CONSTRAINT "case_forms_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "case_forms" ADD CONSTRAINT "case_forms_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
