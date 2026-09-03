import { describe, expect, it } from "vitest";
import {
  assertAdminCancellable,
  assertGuestCancellable,
  assertMarkPaidAllowed,
  assertRefundAllowed,
  computeBookingPrice,
  resolveRefundMethod,
  resolveRefundStatus,
} from "../../../src/services/booking-state.service.ts";
import ApiError from "../../../src/lib/errors/ApiError.ts";

function dateOn(day: number): Date {
  return new Date(Date.UTC(2026, 0, day));
}

describe("computeBookingPrice", () => {
  const monthlyRate = 6000;

  it("charges per night for a 1-night stay", () => {
    const price = computeBookingPrice(monthlyRate, dateOn(1), dateOn(2));
    expect(price.nights).toBe(1);
    expect(price.rateType).toBe("NIGHTLY");
    expect(price.total).toBe(200);
  });

  it("charges per night for a 29-night stay", () => {
    const price = computeBookingPrice(monthlyRate, dateOn(1), dateOn(30));
    expect(price.nights).toBe(29);
    expect(price.rateType).toBe("NIGHTLY");
    expect(price.total).toBe(5800);
  });

  it("switches to monthly at exactly 30 nights", () => {
    const price = computeBookingPrice(monthlyRate, dateOn(1), dateOn(31));
    expect(price.nights).toBe(30);
    expect(price.months).toBe(1);
    expect(price.rateType).toBe("MONTHLY");
    expect(price.total).toBe(6000);
  });

  it("charges two started months for a 45-night stay", () => {
    const price = computeBookingPrice(monthlyRate, dateOn(1), dateOn(15 + 30));
    expect(price.nights).toBe(44);
    expect(price.months).toBe(2);
    expect(price.rateType).toBe("MONTHLY");
    expect(price.total).toBe(12000);
  });

  it("never prices below one night", () => {
    const price = computeBookingPrice(monthlyRate, dateOn(5), dateOn(5));
    expect(price.nights).toBe(1);
    expect(price.total).toBe(200);
  });

  it("rounds nightly totals to two decimals", () => {
    const price = computeBookingPrice(5555, dateOn(1), dateOn(2));
    expect(price.nightlyRate).toBe(185.17);
    expect(price.total).toBe(185.17);
  });
});

describe("assertGuestCancellable", () => {
  it("allows pending bookings", () => {
    expect(() => assertGuestCancellable("PENDING")).not.toThrow();
  });

  it.each(["CONFIRMED", "ONGOING", "COMPLETED", "CANCELLED", "REJECTED"])(
    "blocks %s bookings",
    (status) => {
      expect(() => assertGuestCancellable(status)).toThrowError(ApiError);
    },
  );
});

describe("assertAdminCancellable", () => {
  it.each(["PENDING", "CONFIRMED"])("allows %s bookings", (status) => {
    expect(() => assertAdminCancellable(status)).not.toThrow();
  });

  it.each(["ONGOING", "COMPLETED", "CANCELLED", "REJECTED"])(
    "blocks %s bookings",
    (status) => {
      expect(() => assertAdminCancellable(status)).toThrowError(ApiError);
    },
  );
});

describe("assertMarkPaidAllowed", () => {
  it("allows offline pending payments", () => {
    expect(() =>
      assertMarkPaidAllowed({ paymentMode: "OFFLINE", paymentStatus: "PENDING" }),
    ).not.toThrow();
  });

  it("blocks online bookings", () => {
    expect(() =>
      assertMarkPaidAllowed({ paymentMode: "ONLINE", paymentStatus: "PENDING" }),
    ).toThrowError(ApiError);
  });

  it("blocks already paid bookings", () => {
    expect(() =>
      assertMarkPaidAllowed({ paymentMode: "OFFLINE", paymentStatus: "PAID" }),
    ).toThrowError(ApiError);
  });

  it("blocks refunded bookings", () => {
    expect(() =>
      assertMarkPaidAllowed({
        paymentMode: "OFFLINE",
        paymentStatus: "REFUNDED",
      }),
    ).toThrowError(ApiError);
  });
});

describe("assertRefundAllowed", () => {
  it.each(["PAID", "PARTIALLY_PAID"])("allows %s payments", (status) => {
    expect(() => assertRefundAllowed(status as "PAID")).not.toThrow();
  });

  it.each(["PENDING", "FAILED", "REFUNDED", "REJECTED"])(
    "blocks %s payments",
    (status) => {
      expect(() => assertRefundAllowed(status as "FAILED")).toThrowError(
        ApiError,
      );
    },
  );
});

describe("resolveRefundStatus", () => {
  const booking = { totalPrice: 5600 };

  it("resolves REFUNDED for full refunds", () => {
    expect(resolveRefundStatus(booking, 5600)).toBe("REFUNDED");
  });

  it("resolves PARTIALLY_PAID for partial refunds", () => {
    expect(resolveRefundStatus(booking, 2000)).toBe("PARTIALLY_PAID");
  });

  it("rejects zero and negative amounts", () => {
    expect(() => resolveRefundStatus(booking, 0)).toThrowError(ApiError);
    expect(() => resolveRefundStatus(booking, -100)).toThrowError(ApiError);
  });

  it("rejects amounts above the booking total", () => {
    expect(() => resolveRefundStatus(booking, 6000)).toThrowError(ApiError);
  });
});

describe("resolveRefundMethod", () => {
  it("defaults online bookings to RAZORPAY", () => {
    expect(resolveRefundMethod("ONLINE")).toBe("RAZORPAY");
  });

  it("defaults offline bookings to CASH", () => {
    expect(resolveRefundMethod("OFFLINE")).toBe("CASH");
  });

  it("uses the explicit method when provided", () => {
    expect(resolveRefundMethod("OFFLINE", "UPI")).toBe("UPI");
  });
});
