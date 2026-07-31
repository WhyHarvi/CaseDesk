ALTER TABLE "appointments"
  ADD COLUMN "purpose" TEXT,
  ADD COLUMN "internal_notes" TEXT;

ALTER TABLE "notes"
  ADD COLUMN "appointment_id" TEXT;

ALTER TABLE "follow_ups"
  ADD COLUMN "appointment_id" TEXT;

ALTER TABLE "notes"
  ADD CONSTRAINT "notes_appointment_id_fkey"
  FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "follow_ups"
  ADD CONSTRAINT "follow_ups_appointment_id_fkey"
  FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "notes_appointment_id_idx" ON "notes"("appointment_id");
CREATE INDEX "follow_ups_appointment_id_idx" ON "follow_ups"("appointment_id");
