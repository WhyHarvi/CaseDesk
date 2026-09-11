ALTER TABLE "subscription_plans"
ADD COLUMN "is_default_for_new_workspaces" BOOLEAN NOT NULL DEFAULT false;

UPDATE "subscription_plans"
SET "is_default_for_new_workspaces" = true
WHERE "key" = 'demo';

CREATE UNIQUE INDEX "subscription_plans_one_workspace_default_key"
ON "subscription_plans" ("is_default_for_new_workspaces")
WHERE "is_default_for_new_workspaces" = true;
