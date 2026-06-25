/*
  Warnings:

  - You are about to drop the column `PaymentMode` on the `Booking` table. All the data in the column will be lost.
  - Added the required column `paymentMode` to the `Booking` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "Booking_PaymentMode_paymentStatus_idx";

-- AlterTable
ALTER TABLE "Booking" DROP COLUMN "PaymentMode",
ADD COLUMN     "paymentMode" "PaymentMode" NOT NULL;

-- CreateIndex
CREATE INDEX "Booking_paymentMode_paymentStatus_idx" ON "Booking"("paymentMode", "paymentStatus");
