ALTER TABLE "case_information_section_states"
  ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "enabled_at" TIMESTAMP(3),
  ADD COLUMN "enabled_by_id" TEXT;

ALTER TABLE "case_information_section_states"
  ADD CONSTRAINT "case_information_section_states_enabled_by_id_fkey" FOREIGN KEY ("enabled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
