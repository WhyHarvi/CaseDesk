CREATE TABLE "shared_library_documents" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "uploaded_by_id" TEXT,
  "title" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'General',
  "description" TEXT,
  "storage_key" TEXT NOT NULL,
  "original_filename" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "file_size" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "shared_library_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "shared_library_documents_agency_id_idx" ON "shared_library_documents"("agency_id");
CREATE INDEX "shared_library_documents_uploaded_by_id_idx" ON "shared_library_documents"("uploaded_by_id");
CREATE INDEX "shared_library_documents_category_idx" ON "shared_library_documents"("category");

ALTER TABLE "shared_library_documents" ADD CONSTRAINT "shared_library_documents_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shared_library_documents" ADD CONSTRAINT "shared_library_documents_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
