CREATE TABLE "booking_slot_holds" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "waitlist_entry_id" TEXT NOT NULL,
  "assigned_to_id" TEXT NOT NULL,
  "session_type_id" TEXT NOT NULL,
  "starts_at" TIMESTAMP(3) NOT NULL,
  "ends_at" TIMESTAMP(3) NOT NULL,
  "claim_token" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "claimed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "booking_slot_holds_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "booking_slot_holds_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "booking_slot_holds_waitlist_entry_id_fkey" FOREIGN KEY ("waitlist_entry_id") REFERENCES "booking_waitlist_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "booking_slot_holds_waitlist_entry_id_key" ON "booking_slot_holds"("waitlist_entry_id");
CREATE UNIQUE INDEX "booking_slot_holds_claim_token_key" ON "booking_slot_holds"("claim_token");
CREATE INDEX "booking_slot_holds_agency_id_assigned_to_id_starts_at_ends_at_expires_at_idx" ON "booking_slot_holds"("agency_id", "assigned_to_id", "starts_at", "ends_at", "expires_at");

ALTER TABLE "booking_slot_holds" ENABLE ROW LEVEL SECURITY;

CREATE POLICY booking_slot_holds_admin_read ON "booking_slot_holds" FOR SELECT TO authenticated
  USING ("agency_id" = current_agency_id() AND current_user_role() = 'admin');
