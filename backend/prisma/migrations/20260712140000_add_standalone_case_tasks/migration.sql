ALTER TABLE "case_workflow_steps"
  ADD COLUMN "is_standalone_task" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "assigned_to_id" TEXT,
  ADD COLUMN "due_at" TIMESTAMP(3);

CREATE INDEX "case_workflow_steps_assigned_to_id_idx" ON "case_workflow_steps"("assigned_to_id");
CREATE INDEX "case_workflow_steps_case_id_is_standalone_task_idx" ON "case_workflow_steps"("case_id", "is_standalone_task");

ALTER TABLE "case_workflow_steps" ADD CONSTRAINT "case_workflow_steps_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
