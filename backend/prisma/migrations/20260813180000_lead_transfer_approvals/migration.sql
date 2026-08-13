DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LeadTransferRequestStatus') THEN
    CREATE TYPE "LeadTransferRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'STALE');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "lead_transfer_requests" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "lead_id" TEXT NOT NULL,
  "from_owner_id" TEXT NOT NULL,
  "to_owner_id" TEXT NOT NULL,
  "requested_by_id" TEXT NOT NULL,
  "status" "LeadTransferRequestStatus" NOT NULL DEFAULT 'PENDING',
  "reviewed_by_id" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "review_note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lead_transfer_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "lead_transfer_requests_agency_id_status_created_at_idx" ON "lead_transfer_requests"("agency_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "lead_transfer_requests_lead_id_status_idx" ON "lead_transfer_requests"("lead_id", "status");
CREATE INDEX IF NOT EXISTS "lead_transfer_requests_requested_by_id_status_idx" ON "lead_transfer_requests"("requested_by_id", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "lead_transfer_requests_one_pending_per_lead_idx" ON "lead_transfer_requests"("agency_id", "lead_id") WHERE "status" = 'PENDING';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_transfer_requests_agency_id_fkey') THEN
    ALTER TABLE "lead_transfer_requests" ADD CONSTRAINT "lead_transfer_requests_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_transfer_requests_lead_id_fkey') THEN
    ALTER TABLE "lead_transfer_requests" ADD CONSTRAINT "lead_transfer_requests_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_transfer_requests_from_owner_id_fkey') THEN
    ALTER TABLE "lead_transfer_requests" ADD CONSTRAINT "lead_transfer_requests_from_owner_id_fkey" FOREIGN KEY ("from_owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_transfer_requests_to_owner_id_fkey') THEN
    ALTER TABLE "lead_transfer_requests" ADD CONSTRAINT "lead_transfer_requests_to_owner_id_fkey" FOREIGN KEY ("to_owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_transfer_requests_requested_by_id_fkey') THEN
    ALTER TABLE "lead_transfer_requests" ADD CONSTRAINT "lead_transfer_requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_transfer_requests_reviewed_by_id_fkey') THEN
    ALTER TABLE "lead_transfer_requests" ADD CONSTRAINT "lead_transfer_requests_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "lead_transfer_requests" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_transfer_requests_staff ON "lead_transfer_requests";
CREATE POLICY lead_transfer_requests_staff ON "lead_transfer_requests" FOR ALL TO authenticated
  USING ("agency_id" = current_agency_id() AND current_user_role() IN ('admin', 'consultant'))
  WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() IN ('admin', 'consultant'));
