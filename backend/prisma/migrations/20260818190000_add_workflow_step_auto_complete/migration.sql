ALTER TABLE "workflow_template_steps"
  ADD COLUMN "auto_complete_trigger" TEXT,
  ADD COLUMN "auto_complete_stage" TEXT;

ALTER TABLE "case_workflow_steps"
  ADD COLUMN "auto_complete_trigger" TEXT,
  ADD COLUMN "auto_complete_stage" TEXT;
