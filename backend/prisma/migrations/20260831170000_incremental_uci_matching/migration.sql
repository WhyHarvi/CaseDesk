-- Additive, nullable columns so the UCI-matching worker can tell "never
-- checked" apart from "checked, no match" and "checked, errored (retry)",
-- and so a persisted extracted UCI can be looked up directly instead of
-- rereading every unresolved message body every pass.
ALTER TABLE "unmatched_communications"
  ADD COLUMN IF NOT EXISTS "extracted_uci" TEXT,
  ADD COLUMN IF NOT EXISTS "uci_checked_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "uci_check_failed_at" TIMESTAMP(3);

-- Bounded hourly rescan: only rows never checked, or whose last check
-- errored, need to be walked — not the full backlog.
CREATE INDEX IF NOT EXISTS "unmatched_communications_resolved_at_channel_uci_checked_at_idx"
  ON "unmatched_communications"("resolved_at", "channel", "uci_checked_at");

-- Targeted lookup used when a case's ImmigrationProfile.uci is set or
-- changed: "which unmatched rows already reference this UCI".
CREATE INDEX IF NOT EXISTS "unmatched_communications_agency_id_extracted_uci_idx"
  ON "unmatched_communications"("agency_id", "extracted_uci");
