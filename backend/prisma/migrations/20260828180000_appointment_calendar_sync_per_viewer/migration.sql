-- AlterTable
ALTER TABLE "appointments" DROP COLUMN "calendar_event_id",
DROP COLUMN "calendar_sync_error",
DROP COLUMN "calendar_sync_status",
DROP COLUMN "calendar_synced_at";

-- CreateTable
CREATE TABLE "appointment_calendar_syncs" (
    "id" TEXT NOT NULL,
    "appointment_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "calendar_event_id" TEXT,
    "sync_status" TEXT NOT NULL DEFAULT 'NotSynced',
    "synced_at" TIMESTAMP(3),
    "sync_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointment_calendar_syncs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "appointment_calendar_syncs_user_id_sync_status_idx" ON "appointment_calendar_syncs"("user_id", "sync_status");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_calendar_syncs_appointment_id_user_id_key" ON "appointment_calendar_syncs"("appointment_id", "user_id");

-- AddForeignKey
ALTER TABLE "appointment_calendar_syncs" ADD CONSTRAINT "appointment_calendar_syncs_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_calendar_syncs" ADD CONSTRAINT "appointment_calendar_syncs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
