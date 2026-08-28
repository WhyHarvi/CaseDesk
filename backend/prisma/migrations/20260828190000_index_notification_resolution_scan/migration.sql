-- Supports the bounded notification reconciliation cursor. Without this,
-- PostgreSQL may walk resolved notification rows on every background pass
-- before finding the next unresolved batch.
CREATE INDEX IF NOT EXISTS "notifications_resolved_at_id_idx"
  ON "notifications"("resolved_at", "id");
