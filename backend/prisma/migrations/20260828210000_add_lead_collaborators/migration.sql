CREATE TABLE "lead_collaborators" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "lead_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lead_collaborators_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "lead_collaborators_lead_id_user_id_key" ON "lead_collaborators"("lead_id", "user_id");
CREATE INDEX "lead_collaborators_agency_id_user_id_idx" ON "lead_collaborators"("agency_id", "user_id");
ALTER TABLE "lead_collaborators" ADD CONSTRAINT "lead_collaborators_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lead_collaborators" ADD CONSTRAINT "lead_collaborators_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lead_collaborators" ADD CONSTRAINT "lead_collaborators_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve every delegation created by the earlier task-based rollout so
-- consultants such as Simar gain durable access immediately on deployment.
INSERT INTO "lead_collaborators" ("id", "agency_id", "lead_id", "user_id")
SELECT gen_random_uuid()::text, f."agency_id", f."lead_id", f."assigned_user_id"
FROM "lead_follow_ups" f
WHERE f."description" = 'Collaborative lead outreach'
ON CONFLICT ("lead_id", "user_id") DO NOTHING;

ALTER TABLE "lead_collaborators" ENABLE ROW LEVEL SECURITY;
CREATE POLICY lead_collaborators_read ON "lead_collaborators" FOR SELECT TO authenticated USING (
  "agency_id" = current_agency_id() AND (current_user_role() IN ('admin', 'frontdesk') OR "user_id" = current_app_user_id())
);
CREATE POLICY lead_collaborators_admin_write ON "lead_collaborators" FOR ALL TO authenticated
  USING ("agency_id" = current_agency_id() AND current_user_role() = 'admin')
  WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() = 'admin');

DROP POLICY IF EXISTS leads_read ON "leads";
CREATE POLICY leads_read ON "leads" FOR SELECT TO authenticated USING (
  "agency_id" = current_agency_id() AND (
    current_user_role() IN ('admin', 'frontdesk') OR
    (current_user_role() = 'consultant' AND (
      "owner_user_id" = current_app_user_id() OR "next_action_owner_id" = current_app_user_id() OR
      EXISTS (SELECT 1 FROM "lead_collaborators" lc WHERE lc."lead_id" = "leads".id AND lc."user_id" = current_app_user_id())
    ))
  )
);

DROP POLICY IF EXISTS leads_update ON "leads";
CREATE POLICY leads_update ON "leads" FOR UPDATE TO authenticated USING (
  "agency_id" = current_agency_id() AND (
    current_user_role() IN ('admin', 'frontdesk') OR
    (current_user_role() = 'consultant' AND (
      "owner_user_id" = current_app_user_id() OR "next_action_owner_id" = current_app_user_id() OR
      EXISTS (SELECT 1 FROM "lead_collaborators" lc WHERE lc."lead_id" = "leads".id AND lc."user_id" = current_app_user_id())
    ))
  )
) WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant','frontdesk'));

DROP POLICY IF EXISTS lead_activities_read ON "lead_activities";
CREATE POLICY lead_activities_read ON "lead_activities" FOR SELECT TO authenticated USING (
  "agency_id" = current_agency_id() AND EXISTS (
    SELECT 1 FROM "leads" l WHERE l.id = "lead_id" AND l."agency_id" = current_agency_id() AND (
      current_user_role() IN ('admin', 'frontdesk') OR l."owner_user_id" = current_app_user_id() OR l."next_action_owner_id" = current_app_user_id() OR
      EXISTS (SELECT 1 FROM "lead_collaborators" lc WHERE lc."lead_id" = l.id AND lc."user_id" = current_app_user_id())
    )
  )
);

DROP POLICY IF EXISTS lead_activities_insert ON "lead_activities";
CREATE POLICY lead_activities_insert ON "lead_activities" FOR INSERT TO authenticated WITH CHECK (
  "agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant','frontdesk') AND EXISTS (
    SELECT 1 FROM "leads" l WHERE l.id = "lead_id" AND l."agency_id" = current_agency_id() AND (
      current_user_role() IN ('admin', 'frontdesk') OR l."owner_user_id" = current_app_user_id() OR l."next_action_owner_id" = current_app_user_id() OR
      EXISTS (SELECT 1 FROM "lead_collaborators" lc WHERE lc."lead_id" = l.id AND lc."user_id" = current_app_user_id())
    )
  )
);
