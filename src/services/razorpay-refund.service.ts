import Razorpay from "razorpay";
import prisma from "../lib/prisma/db.ts";
import ApiError from "../lib/errors/ApiError.ts";

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID!,
  key_secret: process.env.RAZORPAY_KEY_SECRET!,
});

/**
 * Refunds a captured Razorpay payment through the gateway. The refund id in
 * the response is the only accepted proof of refund for ONLINE bookings —
 * a refund that never touched Razorpay cannot produce one.
 *
 * Amount is in rupees; Razorpay expects paise. Partial refunds are native
 * (amount < captured amount). Gateway limits (6-month age, over-refund)
 * surface as ApiError 400s.
 */
export async function initiateGatewayRefund(
  bookingId: string,
  amount: number,
): Promise<{ refundId: string; status: string }> {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ApiError("Refund amount must be greater than zero", 400);
  }

  const payment = await prisma.payment.findFirst({
    where: {
      bookingId,
      provider: "RAZORPAY",
      status: "PAID",
      razorpayPaymentId: { not: null },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!payment?.razorpayPaymentId) {
    throw new ApiError(
      "No captured Razorpay payment found for this booking",
      400,
    );
  }

  try {
    const refund = await razorpay.payments.refund(payment.razorpayPaymentId, {
      amount: Math.round(amount * 100),
      speed: "normal",
      notes: { bookingId },
    });

    return { refundId: refund.id, status: String(refund.status) };
  } catch (err) {
    const description =
      (err as { error?: { description?: string } })?.error?.description ??
      (err as Error)?.message ??
      "Unknown Razorpay error";
    throw new ApiError(`Razorpay refund failed: ${description}`, 400);
  }
}
