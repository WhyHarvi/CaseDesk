-- Repair environments where the autofill migration was recorded before its
-- Generated enum addition was present in the migration file.
ALTER TYPE "CaseFormVersionSource" ADD VALUE IF NOT EXISTS 'Generated';
