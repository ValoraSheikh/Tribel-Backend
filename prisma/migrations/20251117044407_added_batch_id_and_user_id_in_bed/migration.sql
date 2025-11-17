-- DropIndex
DROP INDEX "Room_roomTemplateId_idx";

-- AlterTable
ALTER TABLE "Bed" ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "Room" ADD COLUMN     "batchId" TEXT;

-- AlterTable
ALTER TABLE "RoomTemplate" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Room_roomTemplateId_batchId_idx" ON "Room"("roomTemplateId", "batchId");

-- AddForeignKey
ALTER TABLE "Bed" ADD CONSTRAINT "Bed_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
