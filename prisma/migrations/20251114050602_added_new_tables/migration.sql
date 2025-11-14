/*
  Warnings:

  - You are about to drop the column `roomTypeId` on the `Booking` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `Property` table. All the data in the column will be lost.
  - The `starRating` column on the `Property` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the column `basePrice` on the `Room` table. All the data in the column will be lost.
  - You are about to drop the column `capacity` on the `Room` table. All the data in the column will be lost.
  - You are about to drop the column `descrption` on the `Room` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `Room` table. All the data in the column will be lost.
  - You are about to drop the `RoomType` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `bedId` to the `Booking` table without a default value. This is not possible if the table is not empty.
  - Added the required column `title` to the `Property` table without a default value. This is not possible if the table is not empty.
  - Added the required column `bedCount` to the `Room` table without a default value. This is not possible if the table is not empty.
  - Added the required column `pricePerBed` to the `Room` table without a default value. This is not possible if the table is not empty.
  - Added the required column `roomTemplateId` to the `Room` table without a default value. This is not possible if the table is not empty.
  - Added the required column `title` to the `Room` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Booking" DROP CONSTRAINT "Booking_roomTypeId_fkey";

-- DropForeignKey
ALTER TABLE "RoomType" DROP CONSTRAINT "RoomType_roomId_fkey";

-- DropIndex
DROP INDEX "Room_propertyId_key";

-- AlterTable
ALTER TABLE "Booking" DROP COLUMN "roomTypeId",
ADD COLUMN     "bedId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Property" DROP COLUMN "name",
ADD COLUMN     "amenities" JSONB,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "title" TEXT NOT NULL,
DROP COLUMN "starRating",
ADD COLUMN     "starRating" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Room" DROP COLUMN "basePrice",
DROP COLUMN "capacity",
DROP COLUMN "descrption",
DROP COLUMN "name",
ADD COLUMN     "bedCount" INTEGER NOT NULL,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "pricePerBed" INTEGER NOT NULL,
ADD COLUMN     "roomTemplateId" TEXT NOT NULL,
ADD COLUMN     "title" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Tenant" ALTER COLUMN "timezone" SET DEFAULT 'Asia/Kolkata';

-- DropTable
DROP TABLE "RoomType";

-- CreateTable
CREATE TABLE "RoomTemplate" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "bedsPerRoom" INTEGER NOT NULL,
    "numberOfRooms" INTEGER NOT NULL,
    "pricePerBed" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "amenities" JSONB,
    "image" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoomTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bed" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "bedNo" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Bed_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoomTemplate_propertyId_idx" ON "RoomTemplate"("propertyId");

-- CreateIndex
CREATE INDEX "Bed_roomId_idx" ON "Bed"("roomId");

-- CreateIndex
CREATE INDEX "Booking_propertyId_idx" ON "Booking"("propertyId");

-- CreateIndex
CREATE INDEX "Booking_roomId_idx" ON "Booking"("roomId");

-- CreateIndex
CREATE INDEX "Booking_bedId_idx" ON "Booking"("bedId");

-- CreateIndex
CREATE INDEX "Booking_startDate_endDate_idx" ON "Booking"("startDate", "endDate");

-- CreateIndex
CREATE INDEX "Room_roomTemplateId_idx" ON "Room"("roomTemplateId");

-- AddForeignKey
ALTER TABLE "RoomTemplate" ADD CONSTRAINT "RoomTemplate_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_roomTemplateId_fkey" FOREIGN KEY ("roomTemplateId") REFERENCES "RoomTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bed" ADD CONSTRAINT "Bed_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_bedId_fkey" FOREIGN KEY ("bedId") REFERENCES "Bed"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
