-- CreateTable
CREATE TABLE "document_folders" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_folders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_folders_case_id_name_key" ON "document_folders"("case_id", "name");

-- CreateIndex
CREATE INDEX "document_folders_agency_id_idx" ON "document_folders"("agency_id");

-- CreateIndex
CREATE INDEX "document_folders_case_id_idx" ON "document_folders"("case_id");

-- AddForeignKey
ALTER TABLE "document_folders" ADD CONSTRAINT "document_folders_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_folders" ADD CONSTRAINT "document_folders_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_folders" ADD CONSTRAINT "document_folders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "client_documents" ADD COLUMN "folder_id" TEXT;

-- CreateIndex
CREATE INDEX "client_documents_folder_id_idx" ON "client_documents"("folder_id");

-- AddForeignKey
ALTER TABLE "client_documents" ADD CONSTRAINT "client_documents_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "document_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
