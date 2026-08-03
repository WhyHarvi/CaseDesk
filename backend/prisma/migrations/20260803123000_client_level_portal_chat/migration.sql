-- A portal account can exist before an immigration case is opened. Allow a
-- secure client-level conversation without manufacturing a placeholder case.
ALTER TABLE "communication_conversations"
  ALTER COLUMN "case_id" DROP NOT NULL;

ALTER TABLE "communication_messages"
  ALTER COLUMN "case_id" DROP NOT NULL;
