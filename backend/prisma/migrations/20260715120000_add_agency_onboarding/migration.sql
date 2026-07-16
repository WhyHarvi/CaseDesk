ALTER TYPE "AccountStatus" ADD VALUE IF NOT EXISTS 'suspended';

CREATE TYPE "AgencyOnboardingStatus" AS ENUM ('pending_setup', 'active', 'incomplete', 'rejected');
CREATE TYPE "AgencyAccessStatus" AS ENUM ('active', 'read_only', 'blocked');
CREATE TYPE "OnboardingRequestStatus" AS ENUM ('pending', 'invited', 'completed', 'expired', 'rejected', 'failed');

ALTER TABLE "agencies"
  ADD COLUMN "onboarding_status" "AgencyOnboardingStatus" NOT NULL DEFAULT 'active',
  ADD COLUMN "access_status" "AgencyAccessStatus" NOT NULL DEFAULT 'active',
  ADD COLUMN "city" TEXT,
  ADD COLUMN "province" TEXT,
  ADD COLUMN "country" TEXT,
  ADD COLUMN "postal_code" TEXT;

-- Existing agencies are already provisioned. New application-created agencies
-- explicitly begin in pending_setup until their invited owner completes setup.
ALTER TABLE "agencies" ALTER COLUMN "onboarding_status" SET DEFAULT 'pending_setup';

CREATE TABLE "onboarding_requests" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "full_name" TEXT NOT NULL,
  "agency_name" TEXT NOT NULL,
  "phone" TEXT,
  "country" TEXT,
  "status" "OnboardingRequestStatus" NOT NULL DEFAULT 'pending',
  "agency_id" TEXT,
  "user_id" TEXT,
  "auth_user_id" UUID,
  "terms_accepted_at" TIMESTAMP(3) NOT NULL,
  "invited_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3),
  "failure_code" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "onboarding_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "onboarding_requests_email_key" ON "onboarding_requests"("email");
CREATE UNIQUE INDEX "onboarding_requests_auth_user_id_key" ON "onboarding_requests"("auth_user_id");
CREATE INDEX "onboarding_requests_status_expires_at_idx" ON "onboarding_requests"("status", "expires_at");
CREATE INDEX "onboarding_requests_agency_id_idx" ON "onboarding_requests"("agency_id");

ALTER TABLE "onboarding_requests"
  ADD CONSTRAINT "onboarding_requests_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "onboarding_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "onboarding_requests" ENABLE ROW LEVEL SECURITY;

-- Onboarding records contain personal information and are accessed only by the
-- trusted Express service. No direct authenticated/anonymous Supabase policy is
-- intentionally granted.
