ALTER TABLE "users" ADD COLUMN "avatar_preset" TEXT;

UPDATE "users"
SET "avatar_preset" = 'avatar-' || ((((hashtext("id") % 12) + 12) % 12) + 1)::text
WHERE "role" IN ('consultant', 'frontdesk')
  AND "avatar_preset" IS NULL;
