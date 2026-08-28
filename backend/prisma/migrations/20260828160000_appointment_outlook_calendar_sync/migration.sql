-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "calendar_event_id" TEXT,
ADD COLUMN     "calendar_sync_error" TEXT,
ADD COLUMN     "calendar_sync_status" TEXT NOT NULL DEFAULT 'NotSynced',
ADD COLUMN     "calendar_synced_at" TIMESTAMP(3);
