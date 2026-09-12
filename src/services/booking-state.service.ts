import ApiError from "../lib/errors/ApiError.ts";
import type {
  BookingStatus,
  PaymentMode,
  PaymentProvider,
  PaymentStatus,
  Prisma,
} from "../generated/prisma/client.ts";
import {
  dateKey,
  daysBetweenKeys,
  hasEnded,
  hasStarted,
  isPreArrival,
  istTodayKey,
  nightsUsed,
} from "../lib/dates.ts";

export const GUEST_CANCELLABLE_STATUSES = ["PENDING", "CONFIRMED"] as const;
export const ADMIN_CANCELLABLE_STATUSES = ["PENDING", "CONFIRMED", "ONGOING"] as const;
export const REFUNDABLE_PAYMENT_STATUSES = ["PAID", "PARTIALLY_PAID"] as const;
export const ACTIVE_BOOKING_STATUSES = ["PENDING", "CONFIRMED", "ONGOING"] as const;
export const TERMINAL_BOOKING_STATUSES = ["CANCELLED", "REJECTED", "COMPLETED"] as const;

export interface BookingPriceBreakdown {
  nights: number;
  months: number;
  rateType: "NIGHTLY" | "MONTHLY";
  nightlyRate: number;
  monthlyRate: number;
  total: number;
}

export interface ProratedSettlement {
  nightsUsed: number;
  amountDue: number;
  refundAmount: number;
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

  // Full months at the monthly rate, leftover nights at the nightly rate.
  // Ceiling the remainder into a whole month made 31 nights bill as two months —
  // a doubling cliff at every 30-day boundary.
  const months = Math.floor(nights / 30);
  const remainderNights = nights - months * 30;

  return {
    nights,
    months,
    rateType: months > 0 ? "MONTHLY" : "NIGHTLY",
    nightlyRate,
    monthlyRate,
    total: round2(months * monthlyRate + remainderNights * nightlyRate),
  };
}

/**
 * Mid-stay settlement: the guest owes the nights consumed (prorated linearly
 * at the nightly rate), the remainder is refundable. Floors at zero.
 */
export function computeProratedSettlement(booking: {
  totalPrice: Prisma.Decimal | number;
  startDate: Date;
  endDate: Date;
  pricePerBed: number;
}): ProratedSettlement {
  const used = nightsUsed(booking.startDate, booking.endDate);
  const amountDue = round2(used * (booking.pricePerBed / 30));
  const total = Number(booking.totalPrice);
  const refundAmount = Math.max(0, round2(total - amountDue));
  return { nightsUsed: used, amountDue, refundAmount };
}

export function assertGuestCancellable(booking: {
  status: string;
  startDate: Date;
  paymentMode: PaymentMode;
  paymentStatus: PaymentStatus;
}): void {
  if (!(GUEST_CANCELLABLE_STATUSES as readonly string[]).includes(booking.status)) {
    if (booking.status === "ONGOING") {
      throw new ApiError(
        "Your stay has already started. Contact the property admin to cancel mid-stay.",
        403,
      );
    }
    throw new ApiError(
      `Bookings with status ${booking.status} cannot be cancelled.`,
      403,
    );
  }

  if (!isPreArrival(booking.startDate)) {
    throw new ApiError(
      "This booking's check-in date has arrived. Cancellation is handled by the property admin.",
      403,
    );
  }

  if (booking.paymentMode === "OFFLINE" && booking.paymentStatus === "PAID") {
    throw new ApiError(
      "Paid offline bookings are cancelled by the property admin so your refund can be recorded.",
      403,
    );
  }
}

export function assertAdminCancellable(booking: {
  status: string;
  endDate: Date;
}): void {
  if (!(ADMIN_CANCELLABLE_STATUSES as readonly string[]).includes(booking.status)) {
    throw new ApiError(
      `Bookings with status ${booking.status} cannot be cancelled`,
      400,
    );
  }

  if (hasEnded(booking.endDate)) {
    throw new ApiError(
      "This booking's stay has ended. Corrections belong on the payment record, not the booking.",
      400,
    );
  }
}

export function assertRejectable(status: string): void {
  if (status !== "PENDING") {
    throw new ApiError("Only pending bookings can be rejected", 400);
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

export type RefundState = "NONE" | "PARTIAL" | "FULL";

export interface RefundLike {
  amount: Prisma.Decimal | number;
  status: string;
}

/** Total refunded, excluding FAILED attempts — those never moved money. */
export function sumRefunds(refunds: RefundLike[]): number {
  return round2(
    refunds
      .filter((refund) => refund.status !== "FAILED")
      .reduce((total, refund) => total + Number(refund.amount), 0),
  );
}

/** What is still refundable on a payment. */
export function refundableBalance(
  capturedAmount: Prisma.Decimal | number,
  refunds: RefundLike[],
): number {
  return Math.max(0, round2(Number(capturedAmount) - sumRefunds(refunds)));
}

/**
 * A refund can never exceed what the payment actually captured, counted
 * cumulatively across prior refunds. The basis is the captured amount rather
 * than the booking total — a partially paid booking must not be able to refund
 * money that was never collected, and refunding twice must not refund twice the
 * amount collected.
 */
export function assertRefundWithinPaid(
  capturedAmount: Prisma.Decimal | number,
  refunds: RefundLike[],
  requested: number,
): void {
  if (!Number.isFinite(requested) || requested <= 0) {
    throw new ApiError("Refund amount must be greater than zero", 400);
  }

  const remaining = refundableBalance(capturedAmount, refunds);

  if (remaining <= 0) {
    throw new ApiError("This payment has already been fully refunded", 400);
  }

  if (requested > remaining) {
    throw new ApiError(
      `Refund amount cannot exceed the remaining refundable balance of ${remaining}`,
      400,
    );
  }
}

/**
 * Only one refund may be in flight per payment. The gateway call is the point
 * of no return, and the cumulative cap is a read-then-write: without this, two
 * requests (a double click, a retry) each pass the cap and refund twice.
 */
export function assertNoRefundInFlight(refunds: RefundLike[]): void {
  const pending = refunds.find((refund) => refund.status === "PENDING");

  if (pending) {
    throw new ApiError(
      `A refund of ${Number(pending.amount)} is already being processed for this payment. Wait for it to settle before refunding again.`,
      409,
    );
  }
}

/**
 * Razorpay refuses refunds on payments older than six months. Guarding here
 * gives the admin an actionable message instead of a raw gateway error.
 */
export function assertRefundWindowOpen(
  capturedAt: Date,
  now: Date = new Date(),
): void {
  const cutoff = new Date(capturedAt);
  cutoff.setMonth(cutoff.getMonth() + 6);

  if (now.getTime() > cutoff.getTime()) {
    throw new ApiError(
      "This payment is older than six months, which is past the gateway's refund window. Record the refund as an offline record instead.",
      400,
    );
  }
}

/**
 * Refund state is derived, never stored on the booking. `paymentStatus`
 * describes what the guest PAID; a refund is a separate dimension, so a
 * fully-paid-then-refunded booking still reports PAID.
 */
export function resolveRefundState(
  capturedAmount: Prisma.Decimal | number,
  refunds: RefundLike[],
): RefundState {
  const refunded = sumRefunds(refunds);

  if (refunded <= 0) return "NONE";
  return refunded < Number(capturedAmount) ? "PARTIAL" : "FULL";
}

/**
 * Everything a client needs to display a booking's money, derived in one place
 * so the UI can never compute it against a different basis than the cap the
 * refund endpoint enforces. `capturedAmount` counts only payments that were
 * actually collected; a FAILED refund never moved money and is excluded.
 */
export interface BookingRefundSummary {
  capturedAmount: number;
  refundedAmount: number;
  refundableAmount: number;
  refundState: RefundState;
  refundPending: boolean;
  refundFailed: boolean;
}

export function summarizeRefunds(
  payments:
    | { amount: Prisma.Decimal | number; status: string }[]
    | null
    | undefined,
  refunds: RefundLike[] | null | undefined,
): BookingRefundSummary {
  const capturedAmount = round2(
    (payments ?? [])
      .filter((payment) => payment.status === "PAID")
      .reduce((total, payment) => total + Number(payment.amount), 0),
  );
  const ledger = refunds ?? [];
  const refundedAmount = sumRefunds(ledger);

  return {
    capturedAmount,
    refundedAmount,
    refundableAmount: Math.max(0, round2(capturedAmount - refundedAmount)),
    refundState: resolveRefundState(capturedAmount, ledger),
    refundPending: ledger.some((refund) => refund.status === "PENDING"),
    refundFailed: ledger.some((refund) => refund.status === "FAILED"),
  };
}

export function resolveRefundMethod(
  paymentMode: PaymentMode,
  method?: PaymentProvider,
): PaymentProvider {
  if (method) return method;
  return paymentMode === "ONLINE" ? "RAZORPAY" : "CASH";
}

export function assertBedAssignable(
  booking: { status: string; roomTemplateId: string },
  bed: { roomTemplateId: string; deletedAt: Date | null },
  overlappingActiveBookings: number,
): void {
  if (!(ACTIVE_BOOKING_STATUSES as readonly string[]).includes(booking.status)) {
    throw new ApiError(
      `Bookings with status ${booking.status} cannot receive a bed assignment`,
      400,
    );
  }

  if (bed.roomTemplateId !== booking.roomTemplateId) {
    throw new ApiError("Bed does not belong to the booked room template", 400);
  }

  if (bed.deletedAt) {
    throw new ApiError("This bed is no longer available", 400);
  }

  if (overlappingActiveBookings > 0) {
    throw new ApiError(
      "This bed is already booked for the selected dates",
      409,
    );
  }
}

export function assertDateChangeAllowed(
  booking: { status: string; startDate: Date; endDate: Date },
  actor: "GUEST" | "ADMIN",
  newStartDate: Date,
  newEndDate: Date,
): void {
  if (
    !(["PENDING", "CONFIRMED", "ONGOING"] as readonly string[]).includes(booking.status)
  ) {
    throw new ApiError(
      `Bookings with status ${booking.status} cannot be rescheduled`,
      400,
    );
  }

  if (actor === "GUEST" && (booking.status === "ONGOING" || hasStarted(booking.startDate))) {
    throw new ApiError(
      "Dates can only be changed by the guest before check-in. Contact the property admin.",
      403,
    );
  }

  if (hasEnded(booking.endDate)) {
    throw new ApiError("This booking's stay has ended and cannot be rescheduled", 400);
  }

  if (newEndDate.getTime() <= newStartDate.getTime()) {
    throw new ApiError("Check-out must be after check-in", 400);
  }
}

/**
 * On-read lifecycle normalization: CONFIRMED becomes ONGOING once the stay has
 * started and a bed is assigned; ONGOING becomes COMPLETED once the checkout
 * day has passed. Unassigned CONFIRMED bookings past their start date stay
 * CONFIRMED — they surface as action-required instead.
 */
export function normalizeBookingStatus(booking: {
  status: BookingStatus;
  startDate: Date;
  endDate: Date;
  bedId: string | null;
}): BookingStatus {
  if (
    booking.status === "CONFIRMED" &&
    booking.bedId &&
    hasStarted(booking.startDate)
  ) {
    return "ONGOING";
  }

  if (booking.status === "ONGOING" && hasEnded(booking.endDate)) {
    return "COMPLETED";
  }

  return booking.status;
}

/**
 * Admin attention flag: a booking whose stay has begun but which is either
 * still pending approval or confirmed without a bed assignment.
 */
export function isActionRequired(booking: {
  status: BookingStatus;
  startDate: Date;
  bedId: string | null;
}): boolean {
  if (!hasStarted(booking.startDate)) return false;
  if (booking.status === "PENDING") return true;
  return booking.status === "CONFIRMED" && !booking.bedId;
}

/** IST calendar keys for a booking's range — used by overlap queries. */
export function bookingRangeKeys(booking: { startDate: Date; endDate: Date }): {
  startKey: string;
  endKey: string;
} {
  return { startKey: dateKey(booking.startDate), endKey: dateKey(booking.endDate) };
}

export { daysBetweenKeys, istTodayKey };
