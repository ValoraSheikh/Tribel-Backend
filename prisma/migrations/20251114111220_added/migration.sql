/*
  Warnings:

  - Added the required column `adminId` to the `Property` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "adminId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "Property_adminId_idx" ON "Property"("adminId");

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
