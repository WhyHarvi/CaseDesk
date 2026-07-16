CREATE TYPE "DocumentVisibility" AS ENUM ('Client', 'Internal');

ALTER TABLE "client_documents"
ADD COLUMN "visibility" "DocumentVisibility" NOT NULL DEFAULT 'Client',
ADD COLUMN "storage_key" TEXT,
ADD COLUMN "original_filename" TEXT,
ADD COLUMN "mime_type" TEXT,
ADD COLUMN "file_size" INTEGER,
ADD COLUMN "uploaded_by_id" TEXT;

UPDATE "client_documents"
SET "visibility" = 'Internal'
WHERE "notes" LIKE '[MY_DOCUMENT]%';

CREATE INDEX "client_documents_uploaded_by_id_idx" ON "client_documents"("uploaded_by_id");

ALTER TABLE "client_documents"
ADD CONSTRAINT "client_documents_uploaded_by_id_fkey"
FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
