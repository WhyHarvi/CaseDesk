CREATE TABLE IF NOT EXISTS "developer_settings" (
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by_id" TEXT,
  CONSTRAINT "developer_settings_pkey" PRIMARY KEY ("key")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'developer_settings_updated_by_id_fkey'
  ) THEN
    ALTER TABLE "developer_settings"
      ADD CONSTRAINT "developer_settings_updated_by_id_fkey"
      FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL;
  END IF;
END $$;
