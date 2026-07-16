CREATE TABLE "written_documents" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "case_id" TEXT NOT NULL,
  "client_document_id" TEXT,
  "title" TEXT NOT NULL,
  "content_html" TEXT NOT NULL DEFAULT '',
  "header_text" TEXT,
  "footer_text" TEXT,
  "show_page_numbers" BOOLEAN NOT NULL DEFAULT true,
  "status" TEXT NOT NULL DEFAULT 'Draft',
  "created_by_id" TEXT NOT NULL,
  "updated_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "written_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "written_document_versions" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "written_document_id" TEXT NOT NULL,
  "version_number" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "content_html" TEXT NOT NULL,
  "header_text" TEXT,
  "footer_text" TEXT,
  "show_page_numbers" BOOLEAN NOT NULL DEFAULT true,
  "client_document_id" TEXT,
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "written_document_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "written_documents_client_document_id_key" ON "written_documents"("client_document_id");
CREATE INDEX "written_documents_agency_id_idx" ON "written_documents"("agency_id");
CREATE INDEX "written_documents_case_id_idx" ON "written_documents"("case_id");
CREATE INDEX "written_documents_client_id_idx" ON "written_documents"("client_id");
CREATE UNIQUE INDEX "written_document_versions_written_document_id_version_number_key" ON "written_document_versions"("written_document_id", "version_number");
CREATE INDEX "written_document_versions_agency_id_idx" ON "written_document_versions"("agency_id");
CREATE INDEX "written_document_versions_written_document_id_idx" ON "written_document_versions"("written_document_id");

ALTER TABLE "written_documents" ADD CONSTRAINT "written_documents_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "written_documents" ADD CONSTRAINT "written_documents_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "written_documents" ADD CONSTRAINT "written_documents_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "written_documents" ADD CONSTRAINT "written_documents_client_document_id_fkey" FOREIGN KEY ("client_document_id") REFERENCES "client_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "written_documents" ADD CONSTRAINT "written_documents_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "written_documents" ADD CONSTRAINT "written_documents_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "written_document_versions" ADD CONSTRAINT "written_document_versions_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "written_document_versions" ADD CONSTRAINT "written_document_versions_written_document_id_fkey" FOREIGN KEY ("written_document_id") REFERENCES "written_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "written_document_versions" ADD CONSTRAINT "written_document_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
