import ApiError from "../lib/errors/ApiError.ts";
import type { PaymentMode, PaymentProvider, PaymentStatus, Prisma } from "../generated/prisma/client.ts";

export const GUEST_CANCELLABLE_STATUSES = ["PENDING"] as const;
export const ADMIN_CANCELLABLE_STATUSES = ["PENDING", "CONFIRMED"] as const;
export const REFUNDABLE_PAYMENT_STATUSES = ["PAID", "PARTIALLY_PAID"] as const;

export interface BookingPriceBreakdown {
  nights: number;
  months: number;
  rateType: "NIGHTLY" | "MONTHLY";
  nightlyRate: number;
  monthlyRate: number;
  total: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function computeBookingPrice(
  pricePerBed: number,
  startDate: Date,
  endDate: Date,
): BookingPriceBreakdown {
  const msPerNight = 24 * 60 * 60 * 1000;
  const nights = Math.max(
    1,
    Math.ceil((endDate.getTime() - startDate.getTime()) / msPerNight),
  );

  const monthlyRate = round2(pricePerBed);
  const nightlyRate = round2(pricePerBed / 30);

  if (nights < 30) {
    return {
      nights,
      months: 0,
      rateType: "NIGHTLY",
      nightlyRate,
      monthlyRate,
      total: round2(nights * nightlyRate),
    };
  }

  const months = Math.ceil(nights / 30);

  return {
    nights,
    months,
    rateType: "MONTHLY",
    nightlyRate,
    monthlyRate,
    total: round2(months * monthlyRate),
  };
}

export function assertGuestCancellable(status: string): void {
  if (!(GUEST_CANCELLABLE_STATUSES as readonly string[]).includes(status)) {
    throw new ApiError(
      "Only pending bookings can be cancelled by the guest. Contact the property admin to cancel a confirmed booking.",
      403,
    );
  }
}

export function assertAdminCancellable(status: string): void {
  if (!(ADMIN_CANCELLABLE_STATUSES as readonly string[]).includes(status)) {
    throw new ApiError(
      `Bookings with status ${status} cannot be cancelled`,
      400,
    );
  }
}

export function assertMarkPaidAllowed(booking: {
  paymentMode: PaymentMode;
  paymentStatus: PaymentStatus;
}): void {
  if (booking.paymentMode !== "OFFLINE") {
    throw new ApiError(
      "Only offline bookings can be marked as paid manually",
      400,
    );
  }

  if (booking.paymentStatus === "PAID") {
    throw new ApiError("Payment is already marked as paid", 409);
  }

  if (booking.paymentStatus !== "PENDING") {
    throw new ApiError(
      `Payment with status ${booking.paymentStatus} cannot be marked as paid`,
      400,
    );
  }
}

export function assertRefundAllowed(paymentStatus: PaymentStatus): void {
  if (
    !(REFUNDABLE_PAYMENT_STATUSES as readonly string[]).includes(paymentStatus)
  ) {
    throw new ApiError(
      `Only paid bookings can be refunded, current status ${paymentStatus}`,
      400,
    );
  }
}

export function resolveRefundStatus(
  booking: { totalPrice: Prisma.Decimal | number },
  refundAmount: number,
): PaymentStatus {
  const total = Number(booking.totalPrice);

  if (refundAmount <= 0) {
    throw new ApiError("Refund amount must be greater than zero", 400);
  }

  if (refundAmount > total) {
    throw new ApiError(
      `Refund amount cannot exceed the booking total of ${total}`,
      400,
    );
  }

  return refundAmount < total ? "PARTIALLY_PAID" : "REFUNDED";
}

export function resolveRefundMethod(
  paymentMode: PaymentMode,
  method?: PaymentProvider,
): PaymentProvider {
  if (method) return method;
  return paymentMode === "ONLINE" ? "RAZORPAY" : "CASH";
}
