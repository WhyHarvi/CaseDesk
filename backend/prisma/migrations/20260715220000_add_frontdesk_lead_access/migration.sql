DROP POLICY IF EXISTS lead_sources_read ON "lead_sources";
CREATE POLICY lead_sources_read ON "lead_sources" FOR SELECT TO authenticated
  USING ("agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant','frontdesk'));

DROP POLICY IF EXISTS lead_campaigns_read ON "lead_campaigns";
CREATE POLICY lead_campaigns_read ON "lead_campaigns" FOR SELECT TO authenticated
  USING ("agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant','frontdesk'));

DROP POLICY IF EXISTS leads_read ON "leads";
CREATE POLICY leads_read ON "leads" FOR SELECT TO authenticated USING (
  "agency_id" = current_agency_id() AND (
    current_user_role() = 'admin' OR
    (current_user_role() IN ('consultant','frontdesk') AND ("owner_user_id" = current_app_user_id() OR "next_action_owner_id" = current_app_user_id()))
  )
);

DROP POLICY IF EXISTS leads_insert ON "leads";
CREATE POLICY leads_insert ON "leads" FOR INSERT TO authenticated WITH CHECK (
  "agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant','frontdesk')
);

DROP POLICY IF EXISTS leads_update ON "leads";
CREATE POLICY leads_update ON "leads" FOR UPDATE TO authenticated
  USING (
    "agency_id" = current_agency_id() AND (
      current_user_role() = 'admin' OR
      (current_user_role() IN ('consultant','frontdesk') AND ("owner_user_id" = current_app_user_id() OR "next_action_owner_id" = current_app_user_id()))
    )
  )
  WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant','frontdesk'));

DROP POLICY IF EXISTS lead_activities_read ON "lead_activities";
CREATE POLICY lead_activities_read ON "lead_activities" FOR SELECT TO authenticated USING (
  "agency_id" = current_agency_id() AND EXISTS (
    SELECT 1 FROM "leads" l WHERE l.id = "lead_id" AND l."agency_id" = current_agency_id() AND (
      current_user_role() = 'admin' OR
      (current_user_role() IN ('consultant','frontdesk') AND (l."owner_user_id" = current_app_user_id() OR l."next_action_owner_id" = current_app_user_id()))
    )
  )
);

DROP POLICY IF EXISTS lead_activities_insert ON "lead_activities";
CREATE POLICY lead_activities_insert ON "lead_activities" FOR INSERT TO authenticated WITH CHECK (
  "agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant','frontdesk') AND EXISTS (
    SELECT 1 FROM "leads" l WHERE l.id = "lead_id" AND l."agency_id" = current_agency_id() AND (
      current_user_role() = 'admin' OR l."owner_user_id" = current_app_user_id() OR l."next_action_owner_id" = current_app_user_id()
    )
  )
);

DROP POLICY IF EXISTS lead_stage_history_read ON "lead_stage_history";
CREATE POLICY lead_stage_history_read ON "lead_stage_history" FOR SELECT TO authenticated USING (
  "agency_id" = current_agency_id() AND EXISTS (
    SELECT 1 FROM "leads" l WHERE l.id = "lead_id" AND l."agency_id" = current_agency_id() AND (
      current_user_role() = 'admin' OR l."owner_user_id" = current_app_user_id() OR l."next_action_owner_id" = current_app_user_id()
    )
  )
);

DROP POLICY IF EXISTS lead_stage_history_insert ON "lead_stage_history";
CREATE POLICY lead_stage_history_insert ON "lead_stage_history" FOR INSERT TO authenticated WITH CHECK (
  "agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant','frontdesk') AND EXISTS (
    SELECT 1 FROM "leads" l WHERE l.id = "lead_id" AND l."agency_id" = current_agency_id() AND (
      current_user_role() = 'admin' OR l."owner_user_id" = current_app_user_id() OR l."next_action_owner_id" = current_app_user_id()
    )
  )
);

DROP POLICY IF EXISTS lead_assignment_history_read ON "lead_assignment_history";
CREATE POLICY lead_assignment_history_read ON "lead_assignment_history" FOR SELECT TO authenticated USING (
  "agency_id" = current_agency_id() AND EXISTS (
    SELECT 1 FROM "leads" l WHERE l.id = "lead_id" AND l."agency_id" = current_agency_id() AND (
      current_user_role() = 'admin' OR l."owner_user_id" = current_app_user_id() OR l."next_action_owner_id" = current_app_user_id()
    )
  )
);

DROP POLICY IF EXISTS lead_assignment_history_insert ON "lead_assignment_history";
CREATE POLICY lead_assignment_history_insert ON "lead_assignment_history" FOR INSERT TO authenticated WITH CHECK (
  "agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant','frontdesk')
);

DROP POLICY IF EXISTS lead_follow_ups_access ON "lead_follow_ups";
CREATE POLICY lead_follow_ups_access ON "lead_follow_ups" FOR ALL TO authenticated
  USING (
    "agency_id" = current_agency_id() AND (
      current_user_role() = 'admin' OR "assigned_user_id" = current_app_user_id() OR EXISTS (
        SELECT 1 FROM "leads" l WHERE l.id = "lead_id" AND l."agency_id" = current_agency_id() AND l."owner_user_id" = current_app_user_id()
      )
    )
  )
  WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant','frontdesk'));

DROP POLICY IF EXISTS lead_lost_details_read ON "lead_lost_details";
CREATE POLICY lead_lost_details_read ON "lead_lost_details" FOR SELECT TO authenticated USING (
  "agency_id" = current_agency_id() AND EXISTS (
    SELECT 1 FROM "leads" l WHERE l.id = "lead_id" AND l."agency_id" = current_agency_id() AND (
      current_user_role() = 'admin' OR l."owner_user_id" = current_app_user_id() OR l."next_action_owner_id" = current_app_user_id()
    )
  )
);

DROP POLICY IF EXISTS lead_lost_details_insert ON "lead_lost_details";
CREATE POLICY lead_lost_details_insert ON "lead_lost_details" FOR INSERT TO authenticated WITH CHECK (
  "agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant','frontdesk') AND EXISTS (
    SELECT 1 FROM "leads" l WHERE l.id = "lead_id" AND l."agency_id" = current_agency_id() AND (
      current_user_role() = 'admin' OR l."owner_user_id" = current_app_user_id() OR l."next_action_owner_id" = current_app_user_id()
    )
  )
);

DROP POLICY IF EXISTS lead_lost_details_update ON "lead_lost_details";
CREATE POLICY lead_lost_details_update ON "lead_lost_details" FOR UPDATE TO authenticated
  USING (
    "agency_id" = current_agency_id() AND EXISTS (
      SELECT 1 FROM "leads" l WHERE l.id = "lead_id" AND l."agency_id" = current_agency_id() AND (
        current_user_role() = 'admin' OR l."owner_user_id" = current_app_user_id() OR l."next_action_owner_id" = current_app_user_id()
      )
    )
  )
  WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant','frontdesk'));

DROP POLICY IF EXISTS lead_consultations_read ON "lead_consultations";
CREATE POLICY lead_consultations_read ON "lead_consultations" FOR SELECT TO authenticated USING (
  "agency_id" = current_agency_id() AND EXISTS (
    SELECT 1 FROM "leads" l WHERE l.id = "lead_id" AND l."agency_id" = current_agency_id() AND (
      current_user_role() = 'admin' OR l."owner_user_id" = current_app_user_id() OR l."next_action_owner_id" = current_app_user_id() OR "consultant_user_id" = current_app_user_id()
    )
  )
);

DROP POLICY IF EXISTS lead_consultations_insert ON "lead_consultations";
CREATE POLICY lead_consultations_insert ON "lead_consultations" FOR INSERT TO authenticated WITH CHECK (
  "agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant','frontdesk') AND EXISTS (
    SELECT 1 FROM "leads" l WHERE l.id = "lead_id" AND l."agency_id" = current_agency_id() AND (
      current_user_role() = 'admin' OR l."owner_user_id" = current_app_user_id() OR l."next_action_owner_id" = current_app_user_id()
    )
  )
);

DROP POLICY IF EXISTS lead_intake_forms_access ON "lead_intake_forms";
CREATE POLICY lead_intake_forms_staff ON "lead_intake_forms" FOR ALL TO authenticated
  USING ("agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant'))
  WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant'));
CREATE POLICY lead_intake_forms_frontdesk_read ON "lead_intake_forms" FOR SELECT TO authenticated
  USING ("agency_id" = current_agency_id() AND current_user_role() = 'frontdesk');
