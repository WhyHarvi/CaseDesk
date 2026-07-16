-- CaseDesk memberships, assignment foundation, and tenant RLS.

DO $$ BEGIN CREATE TYPE "AccountStatus" AS ENUM ('active', 'disabled', 'invited'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "AssignmentType" AS ENUM ('primary', 'supporting', 'reviewer'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "AssignmentStatus" AS ENUM ('active', 'inactive'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "agencies" ADD COLUMN IF NOT EXISTS "slug" TEXT;
ALTER TABLE "agencies" ADD COLUMN IF NOT EXISTS "status" "AccountStatus" NOT NULL DEFAULT 'active';
CREATE UNIQUE INDEX IF NOT EXISTS "agencies_slug_key" ON "agencies"("slug");

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "auth_user_id" UUID;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "status" "AccountStatus" NOT NULL DEFAULT 'active';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "must_change_password" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS "users_auth_user_id_key" ON "users"("auth_user_id");
CREATE INDEX IF NOT EXISTS "users_auth_user_id_idx" ON "users"("auth_user_id");
CREATE INDEX IF NOT EXISTS "users_agency_id_status_idx" ON "users"("agency_id", "status");

CREATE TABLE IF NOT EXISTS "agency_members" (
  "id" TEXT PRIMARY KEY,
  "agency_id" TEXT NOT NULL REFERENCES "agencies"("id") ON DELETE CASCADE,
  "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role" "UserRole" NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "permissions" JSONB NOT NULL DEFAULT '{}',
  "must_change_password" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "agency_members_agency_id_user_id_key" ON "agency_members"("agency_id", "user_id");
CREATE INDEX IF NOT EXISTS "agency_members_user_id_is_active_idx" ON "agency_members"("user_id", "is_active");
CREATE INDEX IF NOT EXISTS "agency_members_agency_id_role_is_active_idx" ON "agency_members"("agency_id", "role", "is_active");

-- Preserve existing installations: legacy staff become consultants and receive
-- an active membership. auth_user_id is linked separately by the bootstrap script.
UPDATE "users" SET "role" = 'consultant' WHERE "role"::text = 'staff';
INSERT INTO "agency_members" ("id", "agency_id", "user_id", "role")
SELECT gen_random_uuid()::text, u."agency_id", u."id", u."role" FROM "users" u
ON CONFLICT ("agency_id", "user_id") DO NOTHING;

CREATE TABLE IF NOT EXISTS "consultant_profiles" (
  "id" TEXT PRIMARY KEY,
  "agency_id" TEXT NOT NULL REFERENCES "agencies"("id") ON DELETE CASCADE,
  "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "employee_id" TEXT,
  "specializations" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "mastery_level" TEXT,
  "maximum_active_cases" INTEGER NOT NULL DEFAULT 20,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "consultant_profiles_agency_id_user_id_key" ON "consultant_profiles"("agency_id", "user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "consultant_profiles_agency_id_employee_id_key" ON "consultant_profiles"("agency_id", "employee_id");
CREATE INDEX IF NOT EXISTS "consultant_profiles_agency_id_idx" ON "consultant_profiles"("agency_id");

CREATE TABLE IF NOT EXISTS "client_users" (
  "id" TEXT PRIMARY KEY,
  "agency_id" TEXT NOT NULL REFERENCES "agencies"("id") ON DELETE CASCADE,
  "client_id" TEXT NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "relationship" TEXT,
  "is_primary" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "client_users_agency_id_client_id_user_id_key" ON "client_users"("agency_id", "client_id", "user_id");
CREATE INDEX IF NOT EXISTS "client_users_agency_id_user_id_idx" ON "client_users"("agency_id", "user_id");
CREATE INDEX IF NOT EXISTS "client_users_client_id_idx" ON "client_users"("client_id");

CREATE TABLE IF NOT EXISTS "case_assignments" (
  "id" TEXT PRIMARY KEY,
  "agency_id" TEXT NOT NULL REFERENCES "agencies"("id") ON DELETE CASCADE,
  "case_id" TEXT NOT NULL REFERENCES "cases"("id") ON DELETE CASCADE,
  "consultant_user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "assignment_type" "AssignmentType" NOT NULL DEFAULT 'primary',
  "status" "AssignmentStatus" NOT NULL DEFAULT 'active',
  "assigned_by" TEXT REFERENCES "users"("id") ON DELETE SET NULL,
  "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "case_assignments_agency_id_case_id_consultant_user_id_assignment_type_key" ON "case_assignments"("agency_id", "case_id", "consultant_user_id", "assignment_type");
CREATE INDEX IF NOT EXISTS "case_assignments_agency_id_consultant_user_id_status_idx" ON "case_assignments"("agency_id", "consultant_user_id", "status");
CREATE INDEX IF NOT EXISTS "case_assignments_case_id_status_idx" ON "case_assignments"("case_id", "status");

ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "client_visible" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "activity_logs" ADD COLUMN IF NOT EXISTS "entity_type" TEXT;
ALTER TABLE "activity_logs" ADD COLUMN IF NOT EXISTS "entity_id" TEXT;
ALTER TABLE "activity_logs" ADD COLUMN IF NOT EXISTS "metadata" JSONB NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS "activity_logs_agency_id_action_created_at_idx" ON "activity_logs"("agency_id", "action", "created_at");

CREATE OR REPLACE FUNCTION public.current_app_user_id() RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id FROM public.users u WHERE u.auth_user_id = auth.uid() AND u.status = 'active' LIMIT 1
$$;
CREATE OR REPLACE FUNCTION public.current_agency_id() RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.agency_id FROM public.agency_members m
  WHERE m.user_id = public.current_app_user_id() AND m.is_active = true LIMIT 1
$$;
CREATE OR REPLACE FUNCTION public.current_user_role() RETURNS "UserRole"
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.role FROM public.agency_members m
  WHERE m.user_id = public.current_app_user_id() AND m.is_active = true LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.current_app_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_agency_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_user_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_app_user_id(), public.current_agency_id(), public.current_user_role() TO authenticated;

ALTER TABLE "agencies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agency_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "consultant_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client_users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "case_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "follow_ups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "appointments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "case_workflow_steps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "activity_logs" ENABLE ROW LEVEL SECURITY;

CREATE POLICY agency_read_own ON "agencies" FOR SELECT TO authenticated USING (id = current_agency_id());
CREATE POLICY agency_admin_update ON "agencies" FOR UPDATE TO authenticated USING (id = current_agency_id() AND current_user_role() = 'admin') WITH CHECK (id = current_agency_id());
CREATE POLICY user_read_own_agency ON "users" FOR SELECT TO authenticated USING ("agency_id" = current_agency_id() AND (current_user_role() = 'admin' OR id = current_app_user_id()));
CREATE POLICY membership_read ON "agency_members" FOR SELECT TO authenticated USING ("agency_id" = current_agency_id() AND (current_user_role() = 'admin' OR "user_id" = current_app_user_id()));
CREATE POLICY membership_admin_write ON "agency_members" FOR ALL TO authenticated USING ("agency_id" = current_agency_id() AND current_user_role() = 'admin') WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() = 'admin');
CREATE POLICY consultant_profile_read ON "consultant_profiles" FOR SELECT TO authenticated USING ("agency_id" = current_agency_id() AND (current_user_role() = 'admin' OR "user_id" = current_app_user_id()));
CREATE POLICY consultant_profile_admin_write ON "consultant_profiles" FOR ALL TO authenticated USING ("agency_id" = current_agency_id() AND current_user_role() = 'admin') WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() = 'admin');
CREATE POLICY client_user_read ON "client_users" FOR SELECT TO authenticated USING ("agency_id" = current_agency_id() AND (current_user_role() = 'admin' OR "user_id" = current_app_user_id()));
CREATE POLICY client_user_staff_write ON "client_users" FOR ALL TO authenticated USING ("agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant')) WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant'));

CREATE POLICY clients_read ON "clients" FOR SELECT TO authenticated USING (
  "agency_id" = current_agency_id() AND (
    current_user_role() = 'admin' OR
    (current_user_role() = 'consultant' AND ("assigned_user_id" = current_app_user_id() OR EXISTS (SELECT 1 FROM cases c JOIN case_assignments ca ON ca.case_id = c.id WHERE c.client_id = clients.id AND ca.consultant_user_id = current_app_user_id() AND ca.status = 'active'))) OR
    (current_user_role() = 'client' AND EXISTS (SELECT 1 FROM client_users cu WHERE cu.client_id = clients.id AND cu.user_id = current_app_user_id()))
  )
);
CREATE POLICY clients_insert_staff ON "clients" FOR INSERT TO authenticated WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant'));
CREATE POLICY clients_update_staff ON "clients" FOR UPDATE TO authenticated USING ("agency_id" = current_agency_id() AND (current_user_role() = 'admin' OR "assigned_user_id" = current_app_user_id())) WITH CHECK ("agency_id" = current_agency_id());
CREATE POLICY clients_delete_admin ON "clients" FOR DELETE TO authenticated USING ("agency_id" = current_agency_id() AND current_user_role() = 'admin');

CREATE POLICY cases_read ON "cases" FOR SELECT TO authenticated USING (
  "agency_id" = current_agency_id() AND (
    current_user_role() = 'admin' OR
    (current_user_role() = 'consultant' AND ("assigned_user_id" = current_app_user_id() OR EXISTS (SELECT 1 FROM case_assignments ca WHERE ca.case_id = cases.id AND ca.consultant_user_id = current_app_user_id() AND ca.status = 'active'))) OR
    (current_user_role() = 'client' AND EXISTS (SELECT 1 FROM client_users cu WHERE cu.client_id = cases.client_id AND cu.user_id = current_app_user_id()))
  )
);
CREATE POLICY cases_staff_write ON "cases" FOR ALL TO authenticated USING ("agency_id" = current_agency_id() AND (current_user_role() = 'admin' OR "assigned_user_id" = current_app_user_id() OR EXISTS (SELECT 1 FROM case_assignments ca WHERE ca.case_id = cases.id AND ca.consultant_user_id = current_app_user_id() AND ca.status = 'active'))) WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant'));
CREATE POLICY case_assignment_read ON "case_assignments" FOR SELECT TO authenticated USING ("agency_id" = current_agency_id() AND (current_user_role() = 'admin' OR "consultant_user_id" = current_app_user_id()));
CREATE POLICY case_assignment_admin_write ON "case_assignments" FOR ALL TO authenticated USING ("agency_id" = current_agency_id() AND current_user_role() = 'admin') WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() = 'admin');

CREATE POLICY documents_read ON "client_documents" FOR SELECT TO authenticated USING (
  "agency_id" = current_agency_id() AND (current_user_role() = 'admin' OR
  (current_user_role() = 'consultant' AND EXISTS (SELECT 1 FROM cases c WHERE c.id = client_documents.case_id AND (c.assigned_user_id = current_app_user_id() OR EXISTS (SELECT 1 FROM case_assignments ca WHERE ca.case_id = c.id AND ca.consultant_user_id = current_app_user_id() AND ca.status = 'active')))) OR
  (current_user_role() = 'client' AND "visibility" = 'Client' AND EXISTS (SELECT 1 FROM client_users cu WHERE cu.client_id = client_documents.client_id AND cu.user_id = current_app_user_id()))));
CREATE POLICY documents_staff_write ON "client_documents" FOR ALL TO authenticated USING ("agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant')) WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant'));

CREATE POLICY notes_read ON "notes" FOR SELECT TO authenticated USING ("agency_id" = current_agency_id() AND (current_user_role() = 'admin' OR (current_user_role() = 'consultant' AND "user_id" = current_app_user_id()) OR (current_user_role() = 'client' AND "client_visible" = true AND EXISTS (SELECT 1 FROM client_users cu WHERE cu.client_id = notes.client_id AND cu.user_id = current_app_user_id()))));
CREATE POLICY notes_staff_write ON "notes" FOR ALL TO authenticated USING ("agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant')) WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant'));

CREATE POLICY followups_read ON "follow_ups" FOR SELECT TO authenticated USING ("agency_id" = current_agency_id() AND (current_user_role() = 'admin' OR "assigned_user_id" = current_app_user_id() OR (current_user_role() = 'client' AND EXISTS (SELECT 1 FROM client_users cu WHERE cu.client_id = follow_ups.client_id AND cu.user_id = current_app_user_id()))));
CREATE POLICY followups_staff_write ON "follow_ups" FOR ALL TO authenticated USING ("agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant')) WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant'));
CREATE POLICY payments_read ON "payments" FOR SELECT TO authenticated USING ("agency_id" = current_agency_id() AND (current_user_role() = 'admin' OR (current_user_role() = 'client' AND EXISTS (SELECT 1 FROM client_users cu WHERE cu.client_id = payments.client_id AND cu.user_id = current_app_user_id())) OR (current_user_role() = 'consultant' AND EXISTS (SELECT 1 FROM clients c WHERE c.id = payments.client_id AND c.assigned_user_id = current_app_user_id()))));
CREATE POLICY payments_admin_write ON "payments" FOR ALL TO authenticated USING ("agency_id" = current_agency_id() AND current_user_role() = 'admin') WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() = 'admin');
CREATE POLICY appointments_read ON "appointments" FOR SELECT TO authenticated USING ("agency_id" = current_agency_id() AND (current_user_role() = 'admin' OR "assigned_to_id" = current_app_user_id() OR (current_user_role() = 'client' AND EXISTS (SELECT 1 FROM client_users cu WHERE cu.client_id = appointments.client_id AND cu.user_id = current_app_user_id()))));
CREATE POLICY appointments_staff_write ON "appointments" FOR ALL TO authenticated USING ("agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant')) WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant'));
CREATE POLICY tasks_read ON "case_workflow_steps" FOR SELECT TO authenticated USING ("agency_id" = current_agency_id() AND (current_user_role() = 'admin' OR "assigned_to_id" = current_app_user_id() OR (current_user_role() = 'client' AND EXISTS (SELECT 1 FROM cases c JOIN client_users cu ON cu.client_id = c.client_id WHERE c.id = case_workflow_steps.case_id AND cu.user_id = current_app_user_id()))));
CREATE POLICY tasks_staff_write ON "case_workflow_steps" FOR ALL TO authenticated USING ("agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant')) WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant'));
CREATE POLICY activity_admin_read ON "activity_logs" FOR SELECT TO authenticated USING ("agency_id" = current_agency_id() AND current_user_role() = 'admin');
-- No authenticated UPDATE or DELETE policy is intentionally defined for activity logs.
