ALTER TABLE "client_documents"
ADD COLUMN "source_shared_library_document_id" TEXT;

CREATE INDEX "client_documents_source_shared_library_document_id_idx"
ON "client_documents"("source_shared_library_document_id");

ALTER TABLE "client_documents"
ADD CONSTRAINT "client_documents_source_shared_library_document_id_fkey"
FOREIGN KEY ("source_shared_library_document_id") REFERENCES "shared_library_documents"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
