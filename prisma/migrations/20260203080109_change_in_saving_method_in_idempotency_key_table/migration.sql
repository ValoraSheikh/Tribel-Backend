/*
  Warnings:

  - The `method` column on the `IdempotencyKey` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "IdempotencyKey" DROP COLUMN "method",
ADD COLUMN     "method" TEXT NOT NULL DEFAULT 'POST';

-- DropEnum
DROP TYPE "Method";
