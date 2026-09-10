ALTER TABLE "workflow_template_steps"
  ADD COLUMN "auto_complete_event" TEXT;

ALTER TABLE "case_workflow_steps"
  ADD COLUMN "auto_complete_event" TEXT;
