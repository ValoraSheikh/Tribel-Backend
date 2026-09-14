import logger from "../lib/logger.ts";
import prisma from "../lib/prisma/db.ts";
import client from "../lib/redis/redis-cache.ts";
import { deleteOccupancyCache } from "../lib/redis/occupancy-cache.ts";

export type RefundOutcome = "PROCESSED" | "FAILED";

export interface SettleRefundInput {
  providerRefundId: string;
  outcome: RefundOutcome;
  /** Razorpay's payment id — used to recover a refund that has no ledger row. */
  gatewayPaymentId?: string | null;
  /** Refunded amount in rupees, as reported by the gateway. */
  amount?: number | null;
  /** Gateway-provided failure description, for the logs. */
  reason?: string | null;
}

export interface SettleRefundResult {
  settled: boolean;
  recovered: boolean;
  message: string;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

async function invalidateRefundCaches(propertyId: string): Promise<void> {
  await client.del(`AdminBookings:${propertyId}`);
  await deleteOccupancyCache(propertyId);
}

/**
 * The single writer for a refund row's own status — both the razorpay webhook
 * and the reconciliation sweep land here, so a refund can only ever settle
 * once and the two paths cannot disagree.
 *
 * A refund that exists at the gateway but has no ledger row (the process died
 * between the Razorpay call and the insert, or the insert failed) is recovered
 * from the gateway's own numbers: for money that moved, the gateway is the
 * source of truth, and silently dropping the webhook would hide it forever.
 *
 * The booking's `paymentStatus` is never touched — refund state is derived.
 */
export async function settleRefund(
  input: SettleRefundInput,
): Promise<SettleRefundResult> {
  const { providerRefundId, outcome, gatewayPaymentId, amount, reason } = input;

  const refund = await prisma.refund.findUnique({
    where: { providerRefundId },
    select: {
      id: true,
      status: true,
      booking: { select: { propertyId: true } },
    },
  });

  if (refund) {
    // Idempotent: a provider retry must not re-settle a row that already landed.
    if (refund.status !== "PENDING") {
      return {
        settled: false,
        recovered: false,
        message: `Refund already ${refund.status.toLowerCase()}`,
      };
    }

    await prisma.refund.update({
      where: { id: refund.id },
      data: {
        status: outcome,
        processedAt: outcome === "PROCESSED" ? new Date() : null,
      },
    });

    await invalidateRefundCaches(refund.booking.propertyId);

    if (outcome === "FAILED") {
      logger.error(
        `[refund] ${providerRefundId} failed at the gateway${reason ? `: ${reason}` : ""}`,
      );
    }

    return {
      settled: true,
      recovered: false,
      message:
        outcome === "PROCESSED" ? "Refund processed" : "Refund failure recorded",
    };
  }

  if (!gatewayPaymentId) {
    logger.error(
      `[refund] webhook for unknown refund id ${providerRefundId} and no payment id to recover it`,
    );
    return { settled: false, recovered: false, message: "Unknown refund id" };
  }

  const payment = await prisma.payment.findUnique({
    where: { razorpayPaymentId: gatewayPaymentId },
    select: {
      id: true,
      bookingId: true,
      amount: true,
      booking: { select: { propertyId: true } },
    },
  });

  if (!payment) {
    logger.error(
      `[refund] refund ${providerRefundId} has no ledger row and payment ${gatewayPaymentId} is unknown`,
    );
    return { settled: false, recovered: false, message: "Unknown refund id" };
  }

  try {
    await prisma.refund.create({
      data: {
        paymentId: payment.id,
        bookingId: payment.bookingId,
        amount: amount != null ? round2(amount) : Number(payment.amount),
        method: "RAZORPAY",
        reference: "gateway-recovered",
        providerRefundId,
        status: outcome,
        processedAt: outcome === "PROCESSED" ? new Date() : null,
      },
    });
  } catch (err) {
    // A concurrent recovery of the same refund is a success, not a failure —
    // providerRefundId is unique, which is what makes this idempotent.
    if ((err as { code?: string }).code === "P2002") {
      return {
        settled: false,
        recovered: false,
        message: "Refund already recorded",
      };
    }
    throw err;
  }

  await invalidateRefundCaches(payment.booking.propertyId);

  logger.warn(
    `[refund] recovered ${providerRefundId} from the gateway — it had no local ledger row`,
  );

  return {
    settled: true,
    recovered: true,
    message: "Refund recovered from the gateway",
  };
}
