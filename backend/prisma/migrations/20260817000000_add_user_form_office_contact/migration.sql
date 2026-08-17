ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "form_office_phone" TEXT,
  ADD COLUMN IF NOT EXISTS "form_office_email" TEXT;
