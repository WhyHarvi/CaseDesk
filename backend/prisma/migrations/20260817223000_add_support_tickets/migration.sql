CREATE TABLE "support_tickets" (
  "id" TEXT NOT NULL,
  "ticket_number" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "reported_by_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'Submitted',
  "description" TEXT NOT NULL,
  "nova_summary" TEXT,
  "page_path" TEXT,
  "error_code" TEXT,
  "error_message" TEXT,
  "diagnostics" JSONB,
  "screenshot_storage_key" TEXT,
  "screenshot_mime_type" TEXT,
  "delivery_status" TEXT NOT NULL DEFAULT 'Pending',
  "delivery_error" TEXT,
  "delivered_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "support_tickets_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE,
  CONSTRAINT "support_tickets_reported_by_id_fkey" FOREIGN KEY ("reported_by_id") REFERENCES "users"("id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "support_tickets_ticket_number_key" ON "support_tickets"("ticket_number");
CREATE INDEX "support_tickets_agency_id_created_at_idx" ON "support_tickets"("agency_id", "created_at" DESC);
CREATE INDEX "support_tickets_status_created_at_idx" ON "support_tickets"("status", "created_at" DESC);

ALTER TABLE "support_tickets" ENABLE ROW LEVEL SECURITY;

