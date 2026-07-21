ALTER TABLE "agency_quickbooks_settings" ADD COLUMN "consult_fee_item_id" TEXT;
ALTER TABLE "agency_quickbooks_settings" ADD COLUMN "consult_fee_item_name" TEXT;
CREATE UNIQUE INDEX "agency_quickbooks_settings_realm_id_key" ON "agency_quickbooks_settings"("realm_id");

ALTER TABLE "booking_settings" ADD COLUMN "consult_fee_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "booking_settings" ADD COLUMN "consult_fee_amount" DECIMAL(10,2);
ALTER TABLE "booking_settings" ADD COLUMN "consult_fee_hold_minutes" INTEGER NOT NULL DEFAULT 20;

CREATE TABLE "booking_payment_holds" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "assigned_to_id" TEXT NOT NULL,
  "session_type_id" TEXT,
  "starts_at" TIMESTAMP(3) NOT NULL,
  "ends_at" TIMESTAMP(3) NOT NULL,
  "claim_token" TEXT NOT NULL,
  "idempotency_key" TEXT,
  "guest_name" TEXT NOT NULL,
  "guest_email" TEXT NOT NULL,
  "guest_email_normalized" TEXT NOT NULL,
  "guest_phone" TEXT,
  "meeting_mode" TEXT NOT NULL,
  "location_id" TEXT,
  "notes" TEXT,
  "amount" DECIMAL(10,2) NOT NULL,
  "qb_customer_id" TEXT NOT NULL,
  "qb_invoice_id" TEXT NOT NULL,
  "qb_invoice_link" TEXT,
  "qb_sync_token" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'AwaitingPayment',
  "source" TEXT NOT NULL DEFAULT 'Public',
  "expires_at" TIMESTAMP(3),
  "paid_at" TIMESTAMP(3),
  "voided_at" TIMESTAMP(3),
  "void_attempts" INTEGER NOT NULL DEFAULT 0,
  "next_void_attempt_at" TIMESTAMP(3),
  "appointment_id" TEXT,
  "created_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "booking_payment_holds_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "booking_payment_holds_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "booking_payment_holds_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "booking_payment_holds_session_type_id_fkey" FOREIGN KEY ("session_type_id") REFERENCES "booking_session_types"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "booking_payment_holds_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "booking_payment_holds_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "booking_payment_holds_claim_token_key" ON "booking_payment_holds"("claim_token");
CREATE UNIQUE INDEX "booking_payment_holds_appointment_id_key" ON "booking_payment_holds"("appointment_id");
CREATE UNIQUE INDEX "booking_payment_holds_agency_id_idempotency_key_key" ON "booking_payment_holds"("agency_id", "idempotency_key");
CREATE UNIQUE INDEX "booking_payment_holds_agency_id_qb_invoice_id_key" ON "booking_payment_holds"("agency_id", "qb_invoice_id");
CREATE INDEX "booking_payment_holds_agency_id_assigned_to_id_starts_at_id" ON "booking_payment_holds"("agency_id", "assigned_to_id", "starts_at", "ends_at", "status", "expires_at");
CREATE INDEX "booking_payment_holds_agency_id_status_expires_at_idx" ON "booking_payment_holds"("agency_id", "status", "expires_at");

CREATE TABLE "quickbooks_webhook_events" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT,
  "realm_id" TEXT NOT NULL,
  "entity_name" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "raw_payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 8,
  "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_at" TIMESTAMP(3),
  "processed_at" TIMESTAMP(3),
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quickbooks_webhook_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quickbooks_webhook_events_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "quickbooks_webhook_events_status_available_at_idx" ON "quickbooks_webhook_events"("status", "available_at");
CREATE INDEX "quickbooks_webhook_events_realm_id_entity_id_entity_name_idx" ON "quickbooks_webhook_events"("realm_id", "entity_id", "entity_name");

ALTER TABLE "booking_payment_holds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quickbooks_webhook_events" ENABLE ROW LEVEL SECURITY;

CREATE POLICY booking_payment_holds_staff ON "booking_payment_holds" FOR ALL TO authenticated
  USING ("agency_id" = current_agency_id() AND current_user_role() IN ('admin', 'consultant', 'frontdesk'))
  WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() IN ('admin', 'consultant', 'frontdesk'));
CREATE POLICY quickbooks_webhook_events_admin ON "quickbooks_webhook_events" FOR ALL TO authenticated
  USING ("agency_id" = current_agency_id() AND current_user_role() = 'admin')
  WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() = 'admin');
