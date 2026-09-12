import Razorpay from "razorpay";
import ApiError from "../lib/errors/ApiError.ts";

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID!,
  key_secret: process.env.RAZORPAY_KEY_SECRET!,
});

export interface GatewayRefund {
  refundId: string;
  status: string;
}

export interface GatewayRefundState {
  refundId: string;
  status: string;
  paymentId: string | null;
  amount: number | null;
}

function gatewayErrorDescription(err: unknown): string {
  return (
    (err as { error?: { description?: string } })?.error?.description ??
    (err as Error)?.message ??
    "Unknown Razorpay error"
  );
}

/**
 * Refunds a captured Razorpay payment through the gateway. The refund id in
 * the response is the only accepted proof of refund for ONLINE bookings —
 * a refund that never touched Razorpay cannot produce one.
 *
 * The payment id is passed in rather than looked up here: the cumulative cap
 * and the ledger row must be backed by the very same payment this call
 * refunds, so the caller owns that selection.
 *
 * Amount is in rupees; Razorpay expects paise. Partial refunds are native
 * (amount < captured amount).
 */
export async function initiateGatewayRefund(
  razorpayPaymentId: string,
  amount: number,
  bookingId: string,
): Promise<GatewayRefund> {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ApiError("Refund amount must be greater than zero", 400);
  }

  try {
    const refund = await razorpay.payments.refund(razorpayPaymentId, {
      amount: Math.round(amount * 100),
      speed: "normal",
      notes: { bookingId },
    });

    return { refundId: refund.id, status: String(refund.status) };
  } catch (err) {
    throw new ApiError(
      `Razorpay refund failed: ${gatewayErrorDescription(err)}`,
      400,
    );
  }
}

/**
 * Reads a refund's current state from the gateway. This is the recovery path
 * for a refund whose `refund.processed` / `refund.failed` webhook never
 * arrived — without it a PENDING ledger row would stay PENDING forever.
 */
export async function fetchGatewayRefund(
  refundId: string,
): Promise<GatewayRefundState> {
  try {
    const refund = await razorpay.refunds.fetch(refundId);

    return {
      refundId: refund.id,
      status: String(refund.status),
      paymentId: refund.payment_id ?? null,
      amount: typeof refund.amount === "number" ? refund.amount / 100 : null,
    };
  } catch (err) {
    throw new ApiError(
      `Could not fetch the refund from Razorpay: ${gatewayErrorDescription(err)}`,
      400,
    );
  }
}

/**
 * Maps a gateway refund status onto the ledger's own vocabulary. `created` and
 * `pending` both mean the money has not moved yet, so the row stays PENDING.
 */
export function mapGatewayRefundStatus(
  status: string,
): "PROCESSED" | "FAILED" | null {
  if (status === "processed") return "PROCESSED";
  if (status === "failed") return "FAILED";
  return null;
}
