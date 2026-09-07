import cron from "node-cron";
import prisma from "../lib/prisma/db.ts";
import client from "../lib/redis/redis-cache.ts";
import { istTodayKey } from "../lib/dates.ts";

export interface LifecycleSweepResult {
  startedToOngoing: number;
  endedToCompleted: number;
  actionRequired: number;
  sweptProperties: string[];
}

/**
 * Daily lifecycle sweep. All conditions are evaluated in IST calendar terms:
 * - CONFIRMED + assigned + check-in day reached  -> ONGOING
 * - ONGOING + checkout day passed               -> COMPLETED
 * - PENDING/CONFIRMED past check-in day         -> action-required count
 *   (admin attention: approve-late/assign or reject+refund; no automatic
 *   money movement)
 *
 * Every transition is idempotent — re-running the sweep is a no-op.
 */
export async function sweepBookingLifecycle(): Promise<LifecycleSweepResult> {
  const todayKey = istTodayKey();
  // 23:59:59 IST today, as a UTC instant — any booking whose calendar day is
  // today or earlier has started by now.
  const istDayEndUtc = new Date(`${todayKey}T18:29:59Z`);
  // 00:00 IST today, as a UTC instant — bookings whose checkout day is
  // strictly before today have ended (end-exclusive semantics).
  const istDayStartUtc = new Date(`${todayKey}T00:00:00+05:30`);

  const startedBookings = await prisma.booking.findMany({
    where: {
      status: "CONFIRMED",
      bedId: { not: null },
      startDate: { lte: istDayEndUtc },
    },
    select: { id: true, propertyId: true },
  });

  const endedBookings = await prisma.booking.findMany({
    where: {
      status: "ONGOING",
      endDate: { lt: istDayStartUtc },
    },
    select: { id: true, propertyId: true },
  });

  if (startedBookings.length > 0) {
    await prisma.booking.updateMany({
      where: {
        id: { in: startedBookings.map((b) => b.id) },
        status: "CONFIRMED",
      },
      data: { status: "ONGOING" },
    });
  }

  if (endedBookings.length > 0) {
    await prisma.booking.updateMany({
      where: {
        id: { in: endedBookings.map((b) => b.id) },
        status: "ONGOING",
      },
      data: { status: "COMPLETED" },
    });
  }

  const actionRequired = await prisma.booking.count({
    where: {
      status: { in: ["PENDING", "CONFIRMED"] },
      startDate: { lte: istDayEndUtc },
    },
  });

  const sweptProperties = [
    ...new Set(
      [...startedBookings, ...endedBookings].map((b) => b.propertyId),
    ),
  ];

  for (const propertyId of sweptProperties) {
    await client.del(`AdminBookings:${propertyId}`);
    await client.del(`Occupancy:${propertyId}:*`);
  }

  return {
    startedToOngoing: startedBookings.length,
    endedToCompleted: endedBookings.length,
    actionRequired,
    sweptProperties,
  };
}

/** Registers the daily IST-midnight lifecycle sweep. */
export function startBookingLifecycleCron(): void {
  cron.schedule("5 0 * * *", async () => {
    try {
      const result = await sweepBookingLifecycle();
      console.log(
        `[booking-lifecycle] swept: ${result.startedToOngoing} -> ONGOING, ` +
          `${result.endedToCompleted} -> COMPLETED, ` +
          `${result.actionRequired} need attention`,
      );
    } catch (err) {
      console.error("[booking-lifecycle] sweep failed", err);
    }
  }, { timezone: "Asia/Kolkata" });
}
