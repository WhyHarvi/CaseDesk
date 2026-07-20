ALTER TABLE "clients"
  ADD COLUMN "qb_customer_id" TEXT,
  ADD COLUMN "qb_sync_status" TEXT,
  ADD COLUMN "qb_sync_error" TEXT,
  ADD COLUMN "qb_synced_at" TIMESTAMP(3);

CREATE INDEX "clients_agency_id_qb_customer_id_idx" ON "clients"("agency_id", "qb_customer_id");
