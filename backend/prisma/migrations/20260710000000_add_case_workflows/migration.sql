CREATE TYPE "CaseWorkflowStepStatus" AS ENUM ('Pending', 'Completed');
CREATE TYPE "WorkflowStepPriority" AS ENUM ('Low', 'Normal', 'High', 'Urgent');

CREATE TABLE "workflow_templates" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "case_type" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "workflow_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workflow_template_steps" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "template_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "sort_order" INTEGER NOT NULL,
  "priority" "WorkflowStepPriority" NOT NULL DEFAULT 'Normal',
  "is_required" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "workflow_template_steps_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "case_workflow_steps" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "case_id" TEXT NOT NULL,
  "template_id" TEXT,
  "template_step_id" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "sort_order" INTEGER NOT NULL,
  "priority" "WorkflowStepPriority" NOT NULL DEFAULT 'Normal',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "status" "CaseWorkflowStepStatus" NOT NULL DEFAULT 'Pending',
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "case_workflow_steps_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "workflow_templates_agency_id_idx" ON "workflow_templates"("agency_id");
CREATE INDEX "workflow_templates_agency_id_case_type_idx" ON "workflow_templates"("agency_id", "case_type");
CREATE INDEX "workflow_template_steps_agency_id_idx" ON "workflow_template_steps"("agency_id");
CREATE INDEX "workflow_template_steps_template_id_idx" ON "workflow_template_steps"("template_id");
CREATE INDEX "case_workflow_steps_agency_id_idx" ON "case_workflow_steps"("agency_id");
CREATE INDEX "case_workflow_steps_case_id_idx" ON "case_workflow_steps"("case_id");
CREATE INDEX "case_workflow_steps_template_id_idx" ON "case_workflow_steps"("template_id");
CREATE INDEX "case_workflow_steps_template_step_id_idx" ON "case_workflow_steps"("template_step_id");

ALTER TABLE "workflow_templates"
  ADD CONSTRAINT "workflow_templates_agency_id_fkey"
  FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workflow_template_steps"
  ADD CONSTRAINT "workflow_template_steps_agency_id_fkey"
  FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workflow_template_steps"
  ADD CONSTRAINT "workflow_template_steps_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "workflow_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "case_workflow_steps"
  ADD CONSTRAINT "case_workflow_steps_agency_id_fkey"
  FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "case_workflow_steps"
  ADD CONSTRAINT "case_workflow_steps_case_id_fkey"
  FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "case_workflow_steps"
  ADD CONSTRAINT "case_workflow_steps_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "workflow_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "case_workflow_steps"
  ADD CONSTRAINT "case_workflow_steps_template_step_id_fkey"
  FOREIGN KEY ("template_step_id") REFERENCES "workflow_template_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;
