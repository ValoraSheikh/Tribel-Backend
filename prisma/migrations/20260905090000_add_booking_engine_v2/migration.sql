-- BookingEngine v2: template-level booking, admin bed assignment,
-- refund lifecycle status, and the double-booking exclusion constraint.

-- CreateEnum
CREATE TYPE "PaymentRefundStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED');

-- Booking.roomTemplateId: backfill from the room the booking was auto-assigned,
-- then make it required. bedId/roomId become optional (assigned by admin later).
ALTER TABLE "Booking" ADD COLUMN "roomTemplateId" TEXT;
UPDATE "Booking" b
SET "roomTemplateId" = r."roomTemplateId"
FROM "Room" r
WHERE b."roomId" = r."id";
ALTER TABLE "Booking" ALTER COLUMN "roomTemplateId" SET NOT NULL;
ALTER TABLE "Booking" ALTER COLUMN "bedId" DROP NOT NULL;
ALTER TABLE "Booking" ALTER COLUMN "roomId" DROP NOT NULL;

-- ForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_roomTemplateId_fkey" FOREIGN KEY ("roomTemplateId") REFERENCES "RoomTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Payment refund lifecycle
ALTER TABLE "Payment" ADD COLUMN "refundStatus" "PaymentRefundStatus";

-- Indexes
CREATE INDEX "Booking_roomTemplateId_idx" ON "Booking"("roomTemplateId");
CREATE INDEX "Booking_template_active_range_idx"
  ON "Booking"("roomTemplateId", "startDate", "endDate")
  WHERE status IN ('PENDING', 'CONFIRMED', 'ONGOING');

-- Double-booking exclusion: one active booking per bed for any overlapping
-- night range. Cancelled/rejected/completed bookings free their range via the
-- partial predicate. tsrange matches the timestamp(3) columns; end-exclusive
-- semantics come from the application layer (checkout morning).
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "Booking"
  ADD CONSTRAINT booking_no_double_bed
  EXCLUDE USING gist (
    "bedId" WITH =,
    tsrange("startDate", "endDate") WITH &&
  )
  WHERE ("bedId" IS NOT NULL AND status IN ('PENDING', 'CONFIRMED', 'ONGOING'));
