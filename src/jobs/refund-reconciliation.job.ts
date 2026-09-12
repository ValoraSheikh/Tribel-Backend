import cron from "node-cron";
import prisma from "../lib/prisma/db.ts";
import client from "../lib/redis/redis-cache.ts";
import {
  fetchGatewayRefund,
  mapGatewayRefundStatus,
} from "../services/razorpay-refund.service.ts";
import { settleRefund } from "../services/refund-ledger.service.ts";

const RECONCILE_LOCK_KEY = "RefundReconciliation:lock";
const RECONCILE_LOCK_TTL_SECONDS = 300;
/** Give the webhook a head start; never race it for a refund that just landed. */
const MIN_AGE_MS = 15 * 60 * 1000;
/** Past this a pending refund is not slow, it is stuck — worth shouting about. */
const STUCK_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 50;

export interface RefundReconciliationResult {
  checked: number;
  settled: number;
  pending: number;
  skipped: number;
  stuck: number;
}

/**
 * Settles refunds whose gateway webhook never arrived.
 *
 * A Razorpay refund is asynchronous: the ledger row stays PENDING until
 * `refund.processed` / `refund.failed` arrives. Without this sweep a dropped
 * webhook leaves the row PENDING forever — still counted against the
 * refundable balance, with no way for the admin to confirm or retry it.
 */
export async function reconcilePendingRefunds(
  now: Date = new Date(),
): Promise<RefundReconciliationResult> {
  const result: RefundReconciliationResult = {
    checked: 0,
    settled: 0,
    pending: 0,
    skipped: 0,
    stuck: 0,
  };

  const pendingRefunds = await prisma.refund.findMany({
    where: {
      status: "PENDING",
      providerRefundId: { not: null },
      createdAt: { lte: new Date(now.getTime() - MIN_AGE_MS) },
    },
    select: { id: true, providerRefundId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
  });

  for (const refund of pendingRefunds) {
    const providerRefundId = refund.providerRefundId;
    if (!providerRefundId) continue;

    result.checked += 1;

    if (now.getTime() - refund.createdAt.getTime() > STUCK_AGE_MS) {
      result.stuck += 1;
      console.error(
        `[refund-reconciliation] refund ${providerRefundId} has been PENDING for over 7 days`,
      );
      continue;
    }

    try {
      const gateway = await fetchGatewayRefund(providerRefundId);
      const outcome = mapGatewayRefundStatus(gateway.status);

      // created / pending at the gateway: the money has not moved yet. The row
      // stays PENDING and the next run looks again.
      if (!outcome) {
        result.pending += 1;
        continue;
      }

      const settlement = await settleRefund({
        providerRefundId,
        outcome,
        gatewayPaymentId: gateway.paymentId,
        amount: gateway.amount,
      });

      if (settlement.settled) {
        result.settled += 1;
      } else {
        result.skipped += 1;
      }
    } catch (err) {
      // One bad refund must not abort the sweep for the others.
      result.skipped += 1;
      console.error(
        `[refund-reconciliation] could not reconcile refund ${providerRefundId}`,
        err,
      );
    }
  }

  return result;
}

/**
 * Runs the sweep under a short Redis lock so overlapping triggers (a restart
 * racing the schedule, or a second container) cannot double-apply. Every
 * settlement is idempotent anyway; the lock just avoids duplicate gateway calls.
 */
async function runReconciliation(
  trigger: "startup" | "scheduled",
): Promise<RefundReconciliationResult | null> {
  let acquired: string | null;

  try {
    acquired = await client.set(
      RECONCILE_LOCK_KEY,
      String(Date.now()),
      "EX",
      RECONCILE_LOCK_TTL_SECONDS,
      "NX",
    );
  } catch (err) {
    console.error("[refund-reconciliation] could not acquire lock", err);
    return null;
  }

  if (acquired !== "OK") return null;

  try {
    const result = await reconcilePendingRefunds();

    if (result.checked > 0 || result.stuck > 0) {
      console.log(
        `[refund-reconciliation] ${trigger}: checked ${result.checked}, settled ${result.settled}, ` +
          `still pending ${result.pending}, stuck ${result.stuck}`,
      );
    }

    return result;
  } catch (err) {
    console.error(`[refund-reconciliation] ${trigger} run failed`, err);
    return null;
  } finally {
    await client.del(RECONCILE_LOCK_KEY);
  }
}

/** Registers the half-hourly refund reconciliation. */
export function startRefundReconciliationCron(): void {
  // node-cron does not replay a window missed while the process was down, so
  // settle anything that piled up while we were away.
  void runReconciliation("startup");

  cron.schedule("*/30 * * * *", () => void runReconciliation("scheduled"));
}
