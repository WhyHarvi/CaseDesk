CREATE TABLE IF NOT EXISTS "lead_routing_rules" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "conditions" JSONB NOT NULL DEFAULT '[]',
  "target_user_id" TEXT NOT NULL,
  "last_matched_at" TIMESTAMP(3),
  "match_count" INTEGER NOT NULL DEFAULT 0,
  "created_by_id" TEXT NOT NULL,
  "updated_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lead_routing_rules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "lead_routing_rules_agency_id_name_key" ON "lead_routing_rules"("agency_id", "name");
CREATE INDEX IF NOT EXISTS "lead_routing_rules_agency_id_is_active_sort_order_idx" ON "lead_routing_rules"("agency_id", "is_active", "sort_order");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_routing_rules_agency_id_fkey') THEN
    ALTER TABLE "lead_routing_rules" ADD CONSTRAINT "lead_routing_rules_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_routing_rules_target_user_id_fkey') THEN
    ALTER TABLE "lead_routing_rules" ADD CONSTRAINT "lead_routing_rules_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_routing_rules_created_by_id_fkey') THEN
    ALTER TABLE "lead_routing_rules" ADD CONSTRAINT "lead_routing_rules_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_routing_rules_updated_by_id_fkey') THEN
    ALTER TABLE "lead_routing_rules" ADD CONSTRAINT "lead_routing_rules_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "lead_routing_rules" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_routing_rules_admin ON "lead_routing_rules";
CREATE POLICY lead_routing_rules_admin ON "lead_routing_rules" FOR ALL TO authenticated
  USING ("agency_id" = current_agency_id() AND current_user_role() = 'admin')
  WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() = 'admin');
