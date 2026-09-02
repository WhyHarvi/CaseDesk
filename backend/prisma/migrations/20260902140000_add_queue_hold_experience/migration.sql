-- Third greeting: what a caller hears on loop while queued waiting for
-- staff to answer (alongside the connecting/voicemail greetings already
-- added).
ALTER TABLE "agency_twilio_settings"
  ADD COLUMN "while_waiting_greeting_text" TEXT;

-- Tracks each individual outbound "ring this staff member" attempt for one
-- queued inbound call, so the app can cancel the others the instant one
-- connects (Twilio's Queue doesn't do this automatically the way a single
-- <Dial><Client> ring group did), and so the answering browser can look up
-- who's calling.
CREATE TABLE "call_ring_dispatches" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "agency_id" TEXT NOT NULL,
  "parent_call_sid" TEXT NOT NULL,
  "dispatched_call_sid" TEXT NOT NULL,
  "identity" TEXT NOT NULL,
  "caller_number" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ringing',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "call_ring_dispatches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "call_ring_dispatches_dispatched_call_sid_key" UNIQUE ("dispatched_call_sid"),
  CONSTRAINT "call_ring_dispatches_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "call_ring_dispatches_agency_id_parent_call_sid_idx"
  ON "call_ring_dispatches" ("agency_id", "parent_call_sid");
