ALTER TABLE "client_documents"
ADD COLUMN "reviewed_by_id" TEXT;

CREATE INDEX "client_documents_reviewed_by_id_idx"
ON "client_documents"("reviewed_by_id");

ALTER TABLE "client_documents"
ADD CONSTRAINT "client_documents_reviewed_by_id_fkey"
FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
