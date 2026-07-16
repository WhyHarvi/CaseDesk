CREATE TYPE "CorrespondenceKind" AS ENUM ('Agreement', 'Letter');

ALTER TABLE "users"
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "job_title" TEXT,
  ADD COLUMN "license_number" TEXT;

CREATE TABLE "correspondence_templates" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "kind" "CorrespondenceKind" NOT NULL,
  "category" TEXT NOT NULL,
  "description" TEXT,
  "content_html" TEXT NOT NULL,
  "case_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "source_name" TEXT,
  "source_url" TEXT,
  "is_system_default" BOOLEAN NOT NULL DEFAULT false,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "version_number" INTEGER NOT NULL DEFAULT 1,
  "created_by_id" TEXT,
  "updated_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "correspondence_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "correspondence_template_versions" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "correspondence_template_id" TEXT NOT NULL,
  "version_number" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "kind" "CorrespondenceKind" NOT NULL,
  "category" TEXT NOT NULL,
  "description" TEXT,
  "content_html" TEXT NOT NULL,
  "case_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "created_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "correspondence_template_versions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "written_documents"
  ADD COLUMN "correspondence_template_id" TEXT,
  ADD COLUMN "correspondence_kind" "CorrespondenceKind",
  ADD COLUMN "correspondence_status" TEXT,
  ADD COLUMN "issued_at" TIMESTAMP(3),
  ADD COLUMN "issued_by_id" TEXT;

CREATE UNIQUE INDEX "correspondence_templates_agency_id_slug_key" ON "correspondence_templates"("agency_id", "slug");
CREATE INDEX "correspondence_templates_agency_id_kind_idx" ON "correspondence_templates"("agency_id", "kind");
CREATE INDEX "correspondence_templates_agency_id_category_idx" ON "correspondence_templates"("agency_id", "category");
CREATE UNIQUE INDEX "correspondence_template_versions_correspondence_template_id_version_number_key" ON "correspondence_template_versions"("correspondence_template_id", "version_number");
CREATE INDEX "correspondence_template_versions_agency_id_idx" ON "correspondence_template_versions"("agency_id");
CREATE INDEX "correspondence_template_versions_correspondence_template_id_idx" ON "correspondence_template_versions"("correspondence_template_id");
CREATE INDEX "correspondence_template_versions_created_by_id_idx" ON "correspondence_template_versions"("created_by_id");
CREATE INDEX "written_documents_correspondence_template_id_idx" ON "written_documents"("correspondence_template_id");
CREATE INDEX "written_documents_case_id_correspondence_kind_idx" ON "written_documents"("case_id", "correspondence_kind");
CREATE INDEX "written_documents_issued_by_id_idx" ON "written_documents"("issued_by_id");

ALTER TABLE "correspondence_templates" ADD CONSTRAINT "correspondence_templates_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "correspondence_templates" ADD CONSTRAINT "correspondence_templates_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "correspondence_templates" ADD CONSTRAINT "correspondence_templates_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "correspondence_template_versions" ADD CONSTRAINT "correspondence_template_versions_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "correspondence_template_versions" ADD CONSTRAINT "correspondence_template_versions_correspondence_template_id_fkey" FOREIGN KEY ("correspondence_template_id") REFERENCES "correspondence_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "correspondence_template_versions" ADD CONSTRAINT "correspondence_template_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "written_documents" ADD CONSTRAINT "written_documents_correspondence_template_id_fkey" FOREIGN KEY ("correspondence_template_id") REFERENCES "correspondence_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "written_documents" ADD CONSTRAINT "written_documents_issued_by_id_fkey" FOREIGN KEY ("issued_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
