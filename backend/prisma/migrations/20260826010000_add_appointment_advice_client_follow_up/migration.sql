-- AlterTable
ALTER TABLE "appointment_advice" ADD COLUMN     "client_follow_up_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "appointment_advice_client_follow_up_id_key" ON "appointment_advice"("client_follow_up_id");

-- CreateIndex
CREATE INDEX "appointment_advice_client_id_idx" ON "appointment_advice"("client_id");

-- AddForeignKey
ALTER TABLE "appointment_advice" ADD CONSTRAINT "appointment_advice_client_follow_up_id_fkey" FOREIGN KEY ("client_follow_up_id") REFERENCES "follow_ups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
