ALTER TABLE "case_forms" ADD COLUMN "source_agency_form_template_id" TEXT;

CREATE TABLE "agency_form_templates" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "form_number" TEXT,
  "normalized_name" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'General',
  "description" TEXT,
  "language" TEXT NOT NULL DEFAULT 'English',
  "source_revision" TEXT,
  "storage_key" TEXT NOT NULL,
  "original_filename" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "file_size" INTEGER NOT NULL,
  "file_hash" TEXT NOT NULL,
  "current_version" INTEGER NOT NULL DEFAULT 1,
  "uploaded_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "agency_form_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agency_form_template_versions" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "agency_form_template_id" TEXT NOT NULL,
  "version_number" INTEGER NOT NULL,
  "source_revision" TEXT,
  "storage_key" TEXT NOT NULL,
  "original_filename" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "file_size" INTEGER NOT NULL,
  "file_hash" TEXT NOT NULL,
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agency_form_template_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agency_form_templates_agency_id_normalized_name_key" ON "agency_form_templates"("agency_id", "normalized_name");
CREATE INDEX "agency_form_templates_agency_id_idx" ON "agency_form_templates"("agency_id");
CREATE INDEX "agency_form_templates_uploaded_by_id_idx" ON "agency_form_templates"("uploaded_by_id");
CREATE UNIQUE INDEX "agency_form_template_versions_agency_form_template_id_version_number_key" ON "agency_form_template_versions"("agency_form_template_id", "version_number");
CREATE INDEX "agency_form_template_versions_agency_id_idx" ON "agency_form_template_versions"("agency_id");
CREATE INDEX "agency_form_template_versions_agency_form_template_id_idx" ON "agency_form_template_versions"("agency_form_template_id");
CREATE INDEX "agency_form_template_versions_created_by_id_idx" ON "agency_form_template_versions"("created_by_id");
CREATE INDEX "case_forms_source_agency_form_template_id_idx" ON "case_forms"("source_agency_form_template_id");

ALTER TABLE "agency_form_templates" ADD CONSTRAINT "agency_form_templates_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agency_form_templates" ADD CONSTRAINT "agency_form_templates_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "agency_form_template_versions" ADD CONSTRAINT "agency_form_template_versions_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agency_form_template_versions" ADD CONSTRAINT "agency_form_template_versions_agency_form_template_id_fkey" FOREIGN KEY ("agency_form_template_id") REFERENCES "agency_form_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agency_form_template_versions" ADD CONSTRAINT "agency_form_template_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "case_forms" ADD CONSTRAINT "case_forms_source_agency_form_template_id_fkey" FOREIGN KEY ("source_agency_form_template_id") REFERENCES "agency_form_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
