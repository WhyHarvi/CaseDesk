ALTER TABLE "agency_twilio_voice_line"
ADD COLUMN "assigned_user_id" TEXT;

CREATE UNIQUE INDEX "agency_twilio_voice_line_assigned_user_id_key"
ON "agency_twilio_voice_line"("assigned_user_id");

ALTER TABLE "agency_twilio_voice_line"
ADD CONSTRAINT "agency_twilio_voice_line_assigned_user_id_fkey"
FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
