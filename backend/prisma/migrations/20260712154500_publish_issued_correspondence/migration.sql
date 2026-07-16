ALTER TABLE "written_documents"
  ADD COLUMN "issued_client_document_id" TEXT;

CREATE UNIQUE INDEX "written_documents_issued_client_document_id_key"
  ON "written_documents"("issued_client_document_id");

ALTER TABLE "written_documents"
  ADD CONSTRAINT "written_documents_issued_client_document_id_fkey"
  FOREIGN KEY ("issued_client_document_id")
  REFERENCES "client_documents"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
