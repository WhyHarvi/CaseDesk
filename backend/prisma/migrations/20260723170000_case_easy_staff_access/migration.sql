-- Case Easy import is a shared internal workspace for administrators,
-- consultants, and front desk staff. Tenant isolation remains mandatory.
DROP POLICY IF EXISTS case_easy_import_contacts_staff ON "case_easy_import_contacts";
CREATE POLICY case_easy_import_contacts_staff
  ON "case_easy_import_contacts"
  FOR ALL TO authenticated
  USING (
    "agency_id" = current_agency_id()
    AND current_user_role() IN ('admin', 'consultant', 'frontdesk')
  )
  WITH CHECK (
    "agency_id" = current_agency_id()
    AND current_user_role() IN ('admin', 'consultant', 'frontdesk')
  );

DROP POLICY IF EXISTS case_easy_import_cases_staff ON "case_easy_import_cases";
CREATE POLICY case_easy_import_cases_staff
  ON "case_easy_import_cases"
  FOR ALL TO authenticated
  USING (
    "agency_id" = current_agency_id()
    AND current_user_role() IN ('admin', 'consultant', 'frontdesk')
  )
  WITH CHECK (
    "agency_id" = current_agency_id()
    AND current_user_role() IN ('admin', 'consultant', 'frontdesk')
  );

DROP POLICY IF EXISTS case_easy_import_report_rows_staff ON "case_easy_import_report_rows";
CREATE POLICY case_easy_import_report_rows_staff
  ON "case_easy_import_report_rows"
  FOR ALL TO authenticated
  USING (
    "agency_id" = current_agency_id()
    AND current_user_role() IN ('admin', 'consultant', 'frontdesk')
  )
  WITH CHECK (
    "agency_id" = current_agency_id()
    AND current_user_role() IN ('admin', 'consultant', 'frontdesk')
  );
