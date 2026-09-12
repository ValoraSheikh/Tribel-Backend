
-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "refundAmount" DECIMAL(12,2),
ADD COLUMN     "refundMethod" "PaymentProvider",
ADD COLUMN     "refundedAt" TIMESTAMP(3);

