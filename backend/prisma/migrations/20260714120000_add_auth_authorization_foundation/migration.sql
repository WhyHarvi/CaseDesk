-- PostgreSQL requires newly added enum values to commit before later migrations
-- can use them in data updates, defaults, indexes, or policies.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'consultant';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'client';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'manager';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'accountant';
