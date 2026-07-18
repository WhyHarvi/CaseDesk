ALTER TABLE "appointments"
  ADD COLUMN "meeting_mode" TEXT NOT NULL DEFAULT 'InPerson',
  ADD COLUMN "meeting_url" TEXT,
  ADD COLUMN "manage_token" TEXT,
  ADD COLUMN "reminder_sent_at" TIMESTAMP(3);

UPDATE "appointments" SET "manage_token" = md5(random()::text || clock_timestamp()::text || id);

CREATE UNIQUE INDEX "appointments_manage_token_key" ON "appointments"("manage_token");
