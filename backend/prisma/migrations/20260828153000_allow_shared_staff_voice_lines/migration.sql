CREATE TABLE "agency_twilio_voice_line_assignees" (
  "line_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agency_twilio_voice_line_assignees_pkey" PRIMARY KEY ("line_id", "user_id")
);

INSERT INTO "agency_twilio_voice_line_assignees" ("line_id", "user_id")
SELECT "id", "assigned_user_id"
FROM "agency_twilio_voice_line"
WHERE "assigned_user_id" IS NOT NULL;

CREATE UNIQUE INDEX "agency_twilio_voice_line_assignees_user_id_key"
ON "agency_twilio_voice_line_assignees"("user_id");

CREATE INDEX "agency_twilio_voice_line_assignees_line_id_idx"
ON "agency_twilio_voice_line_assignees"("line_id");

ALTER TABLE "agency_twilio_voice_line_assignees"
ADD CONSTRAINT "agency_twilio_voice_line_assignees_line_id_fkey"
FOREIGN KEY ("line_id") REFERENCES "agency_twilio_voice_line"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agency_twilio_voice_line_assignees"
ADD CONSTRAINT "agency_twilio_voice_line_assignees_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agency_twilio_voice_line"
DROP CONSTRAINT "agency_twilio_voice_line_assigned_user_id_fkey";

DROP INDEX "agency_twilio_voice_line_assigned_user_id_key";

ALTER TABLE "agency_twilio_voice_line"
DROP COLUMN "assigned_user_id";
