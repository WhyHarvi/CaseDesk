ALTER TABLE "leads"
  ADD COLUMN "preferred_contact_time" TEXT,
  ADD COLUMN "consent_given" BOOLEAN,
  ADD COLUMN "consent_given_at" TIMESTAMP(3);
