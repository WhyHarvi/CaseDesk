CREATE TABLE "payment_schedule_templates" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "case_type" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_schedule_templates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_schedule_templates_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "payment_schedule_templates_agency_id_case_type_idx" ON "payment_schedule_templates"("agency_id", "case_type");

CREATE TABLE "payment_schedule_template_installments" (
  "id" TEXT NOT NULL,
  "template_id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "payment_type" TEXT NOT NULL,
  "amount" DECIMAL(10,2) NOT NULL,
  "trigger_type" TEXT NOT NULL,
  "trigger_stage" TEXT,
  "trigger_days_after_signing" INTEGER,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "payment_schedule_template_installments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_schedule_template_installments_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "payment_schedule_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "payment_schedule_template_installments_template_id_idx" ON "payment_schedule_template_installments"("template_id");

CREATE TABLE "case_payment_schedules" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "case_id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "signing_date" TIMESTAMP(3) NOT NULL,
  "created_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "case_payment_schedules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "case_payment_schedules_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "case_payment_schedules_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "case_payment_schedules_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "case_payment_schedules_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "case_payment_schedules_case_id_key" ON "case_payment_schedules"("case_id");
CREATE INDEX "case_payment_schedules_agency_id_idx" ON "case_payment_schedules"("agency_id");

CREATE TABLE "case_payment_installments" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "schedule_id" TEXT NOT NULL,
  "case_id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "payment_type" TEXT NOT NULL,
  "amount" DECIMAL(10,2) NOT NULL,
  "trigger_type" TEXT NOT NULL,
  "trigger_stage" TEXT,
  "trigger_date" TIMESTAMP(3),
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'Scheduled',
  "case_invoice_id" TEXT,
  "invoiced_at" TIMESTAMP(3),
  "voided_at" TIMESTAMP(3),
  "voided_by_id" TEXT,
  "void_reason" TEXT,
  "created_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "case_payment_installments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "case_payment_installments_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "case_payment_installments_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "case_payment_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "case_payment_installments_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "case_payment_installments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "case_payment_installments_case_invoice_id_fkey" FOREIGN KEY ("case_invoice_id") REFERENCES "case_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "case_payment_installments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "case_payment_installments_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "case_payment_installments_agency_id_case_id_idx" ON "case_payment_installments"("agency_id", "case_id");
CREATE INDEX "case_payment_installments_agency_id_status_idx" ON "case_payment_installments"("agency_id", "status");
CREATE INDEX "case_payment_installments_agency_id_trigger_type_status_idx" ON "case_payment_installments"("agency_id", "trigger_type", "status");

CREATE TABLE "agency_payment_notification_settings" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "notify_by_email" BOOLEAN NOT NULL DEFAULT true,
  "notify_by_sms" BOOLEAN NOT NULL DEFAULT false,
  "email_subject_template" TEXT,
  "email_body_template" TEXT,
  "sms_template" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "agency_payment_notification_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agency_payment_notification_settings_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "agency_payment_notification_settings_agency_id_key" ON "agency_payment_notification_settings"("agency_id");

ALTER TABLE "payment_schedule_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_schedule_template_installments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "case_payment_schedules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "case_payment_installments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agency_payment_notification_settings" ENABLE ROW LEVEL SECURITY;

CREATE POLICY payment_schedule_templates_staff ON "payment_schedule_templates" FOR ALL TO authenticated
  USING ("agency_id" = current_agency_id() AND current_user_role() IN ('admin', 'consultant'))
  WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() IN ('admin', 'consultant'));
CREATE POLICY case_payment_schedules_staff ON "case_payment_schedules" FOR ALL TO authenticated
  USING ("agency_id" = current_agency_id() AND current_user_role() IN ('admin', 'consultant'))
  WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() IN ('admin', 'consultant'));
CREATE POLICY case_payment_installments_staff ON "case_payment_installments" FOR ALL TO authenticated
  USING ("agency_id" = current_agency_id() AND current_user_role() IN ('admin', 'consultant'))
  WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() IN ('admin', 'consultant'));
CREATE POLICY agency_payment_notification_settings_admin ON "agency_payment_notification_settings" FOR ALL TO authenticated
  USING ("agency_id" = current_agency_id() AND current_user_role() = 'admin')
  WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() = 'admin');
