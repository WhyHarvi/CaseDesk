ALTER TABLE "ooma_call_sessions"
ADD COLUMN IF NOT EXISTS "appointment_id" TEXT;

CREATE INDEX IF NOT EXISTS "ooma_call_sessions_appointment_id_idx"
ON "ooma_call_sessions"("appointment_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ooma_call_sessions_appointment_id_fkey'
  ) THEN
    ALTER TABLE "ooma_call_sessions"
    ADD CONSTRAINT "ooma_call_sessions_appointment_id_fkey"
    FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
