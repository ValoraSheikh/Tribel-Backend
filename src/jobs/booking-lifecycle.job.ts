import cron from "node-cron";
import prisma from "../lib/prisma/db.ts";
import client from "../lib/redis/redis-cache.ts";
import { deleteOccupancyCache } from "../lib/redis/occupancy-cache.ts";
import { istTodayKey } from "../lib/dates.ts";

export interface LifecycleSweepResult {
  startedToOngoing: number;
  endedToCompleted: number;
  actionRequired: number;
  sweptProperties: string[];
}

const SWEEP_LOCK_KEY = "BookingLifecycle:sweepLock";
const SWEEP_LOCK_TTL_SECONDS = 300;

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
    await deleteOccupancyCache(propertyId);
  }

  return {
    startedToOngoing: startedBookings.length,
    endedToCompleted: endedBookings.length,
    actionRequired,
    sweptProperties,
  };
}

/**
 * Runs the sweep under a short Redis lock so overlapping triggers (the startup
 * catch-up racing the scheduled run, or a second container) cannot double-apply.
 * Returns null when another sweep already holds the lock, or when Redis is
 * unavailable — a skipped sweep is safe because every transition is idempotent.
 */
async function runSweep(
  trigger: "startup" | "scheduled",
): Promise<LifecycleSweepResult | null> {
  let acquired: string | null;

  try {
    acquired = await client.set(
      SWEEP_LOCK_KEY,
      String(Date.now()),
      "EX",
      SWEEP_LOCK_TTL_SECONDS,
      "NX",
    );
  } catch (err) {
    console.error("[booking-lifecycle] could not acquire sweep lock", err);
    return null;
  }

  if (acquired !== "OK") return null;

  try {
    const result = await sweepBookingLifecycle();
    console.log(
      `[booking-lifecycle] ${trigger} sweep: ${result.startedToOngoing} -> ONGOING, ` +
        `${result.endedToCompleted} -> COMPLETED, ` +
        `${result.actionRequired} need attention`,
    );
    return result;
  } catch (err) {
    console.error(`[booking-lifecycle] ${trigger} sweep failed`, err);
    return null;
  } finally {
    await client.del(SWEEP_LOCK_KEY);
  }
}

/** Registers the daily IST-midnight lifecycle sweep. */
export function startBookingLifecycleCron(): void {
  // Catch up immediately. node-cron does not replay a window that was missed
  // while the process was down, so without this a restart around 00:05 IST
  // costs a full day of un-advanced statuses.
  void runSweep("startup");

  cron.schedule("5 0 * * *", () => void runSweep("scheduled"), {
    timezone: "Asia/Kolkata",
  });
}
