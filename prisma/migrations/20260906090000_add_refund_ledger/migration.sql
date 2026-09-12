-- Refund ledger: one row per refund event replaces the single set of refund
-- fields on Payment. Previously each refund overwrote `refundAmount`, so a
-- second partial refund erased the first and the cap could only ever be
-- checked per-refund against the booking total. The ledger makes the refunded
-- total a sum, and the cap is enforced against what the payment captured.

CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "PaymentProvider" NOT NULL,
    "reference" TEXT,
    "providerRefundId" TEXT,
    "status" "PaymentRefundStatus" NOT NULL DEFAULT 'PENDING',
    "processedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- Backfill before dropping the source columns: every refund already recorded on
-- Payment becomes exactly one ledger row.
INSERT INTO "Refund" (
    "id",
    "paymentId",
    "bookingId",
    "amount",
    "method",
    "reference",
    "providerRefundId",
    "status",
    "processedAt",
    "createdAt"
)
SELECT
    gen_random_uuid()::text,
    p."id",
    p."bookingId",
    p."refundAmount",
    COALESCE(p."refundMethod", p."provider"),
    p."offlineReference",
    p."razorpayRefundId",
    COALESCE(p."refundStatus", 'PROCESSED'::"PaymentRefundStatus"),
    p."refundedAt",
    COALESCE(p."refundedAt", p."updatedAt")
FROM "Payment" p
WHERE p."refundAmount" IS NOT NULL;

CREATE UNIQUE INDEX "Refund_providerRefundId_key" ON "Refund"("providerRefundId");
CREATE INDEX "Refund_bookingId_idx" ON "Refund"("bookingId");
CREATE INDEX "Refund_paymentId_idx" ON "Refund"("paymentId");
CREATE INDEX "Refund_status_createdAt_idx" ON "Refund"("status", "createdAt");

ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The ledger replaces these. Dropping "razorpayRefundId" also drops its unique
-- index ("Payment_razorpayRefundId_key").
ALTER TABLE "Payment"
    DROP COLUMN "razorpayRefundId",
    DROP COLUMN "refundAmount",
    DROP COLUMN "refundMethod",
    DROP COLUMN "refundStatus",
    DROP COLUMN "refundedAt";
