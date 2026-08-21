-- Voice lines: each Twilio number configured for calling gets a row with its
-- inbound routing rule (FRONTDESK rings frontdesk only, STAFF rings everyone,
-- INTERNAL is the office line used for staff calls and transfers).
CREATE TABLE "agency_twilio_voice_line" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "number_sid" TEXT NOT NULL,
  "phone_number" TEXT NOT NULL,
  "label" TEXT NOT NULL DEFAULT 'Line',
  "routing" TEXT NOT NULL DEFAULT 'STAFF',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "agency_twilio_voice_line_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agency_twilio_voice_line_number_sid_key" ON "agency_twilio_voice_line"("number_sid");
CREATE INDEX "agency_twilio_voice_line_agency_id_idx" ON "agency_twilio_voice_line"("agency_id");

-- Every line belongs to an agency; removing the agency removes its lines.
ALTER TABLE "agency_twilio_voice_line" ADD CONSTRAINT "agency_twilio_voice_line_agency_id_fkey"
  FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
