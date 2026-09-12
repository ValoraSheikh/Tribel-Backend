import { describe, expect, it } from "vitest";
import {
  assertAdminCancellable,
  assertBedAssignable,
  assertDateChangeAllowed,
  assertGuestCancellable,
  assertMarkPaidAllowed,
  assertNoRefundInFlight,
  assertRefundAllowed,
  assertRefundWindowOpen,
  assertRefundWithinPaid,
  computeBookingPrice,
  computeProratedSettlement,
  isActionRequired,
  normalizeBookingStatus,
  refundableBalance,
  resolveRefundMethod,
  resolveRefundState,
  sumRefunds,
  summarizeRefunds,
} from "../../../src/services/booking-state.service.ts";
import ApiError from "../../../src/lib/errors/ApiError.ts";

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

describe("computeBookingPrice", () => {
  const monthlyRate = 6000;

  it("charges per night for a 1-night stay", () => {
    const price = computeBookingPrice(monthlyRate, daysFromNow(1), daysFromNow(2));
    expect(price.nights).toBe(1);
    expect(price.rateType).toBe("NIGHTLY");
    expect(price.total).toBe(200);
  });

  it("charges per night for a 29-night stay", () => {
    const price = computeBookingPrice(monthlyRate, daysFromNow(1), daysFromNow(30));
    expect(price.nights).toBe(29);
    expect(price.rateType).toBe("NIGHTLY");
    expect(price.total).toBe(5800);
  });

  it("switches to monthly at exactly 30 nights", () => {
    const price = computeBookingPrice(monthlyRate, daysFromNow(1), daysFromNow(31));
    expect(price.nights).toBe(30);
    expect(price.months).toBe(1);
    expect(price.rateType).toBe("MONTHLY");
    expect(price.total).toBe(6000);
  });

  it("prices leftover nights instead of rounding up to a whole month (45 nights)", () => {
    const price = computeBookingPrice(monthlyRate, daysFromNow(1), daysFromNow(46));
    expect(price.nights).toBe(45);
    expect(price.months).toBe(1);
    expect(price.rateType).toBe("MONTHLY");
    expect(price.total).toBe(9000);
  });

  it("does not double the bill one night past a month boundary", () => {
    const start = daysFromNow(1);
    const at30 = computeBookingPrice(
      monthlyRate,
      start,
      new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000),
    );
    const at31 = computeBookingPrice(
      monthlyRate,
      start,
      new Date(start.getTime() + 31 * 24 * 60 * 60 * 1000),
    );

    expect(at30.total).toBe(6000);
    expect(at31.nights).toBe(31);
    expect(at31.months).toBe(1);
    expect(at31.total).toBe(6200);
    expect(at31.total).toBeLessThan(at30.total * 2);
  });

  it("charges two full months at 60 nights and adds the remainder at 61", () => {
    const start = daysFromNow(1);
    const at60 = computeBookingPrice(
      monthlyRate,
      start,
      new Date(start.getTime() + 60 * 24 * 60 * 60 * 1000),
    );
    const at61 = computeBookingPrice(
      monthlyRate,
      start,
      new Date(start.getTime() + 61 * 24 * 60 * 60 * 1000),
    );

    expect(at60.months).toBe(2);
    expect(at60.total).toBe(12000);
    expect(at61.months).toBe(2);
    expect(at61.total).toBe(12200);
  });

  it("never decreases as the stay gets longer", () => {
    const start = daysFromNow(1);
    let previous = 0;

    for (let nights = 1; nights <= 95; nights += 1) {
      const end = new Date(start.getTime() + nights * 24 * 60 * 60 * 1000);
      const price = computeBookingPrice(monthlyRate, start, end);

      expect(price.nights).toBe(nights);
      expect(price.total).toBeGreaterThanOrEqual(previous);
      previous = price.total;
    }
  });

  it("never prices below one night", () => {
    const price = computeBookingPrice(monthlyRate, daysFromNow(5), daysFromNow(5));
    expect(price.nights).toBe(1);
    expect(price.total).toBe(200);
  });

  it("rounds nightly totals to two decimals", () => {
    const price = computeBookingPrice(5555, daysFromNow(1), daysFromNow(2));
    expect(price.nightlyRate).toBe(185.17);
    expect(price.total).toBe(185.17);
  });
});

describe("assertGuestCancellable", () => {
  const futureStart = daysFromNow(5);
  const pastStart = daysFromNow(-2);

  it("allows pending unpaid offline bookings before arrival", () => {
    expect(() =>
      assertGuestCancellable({
        status: "PENDING",
        startDate: futureStart,
        paymentMode: "OFFLINE",
        paymentStatus: "PENDING",
      }),
    ).not.toThrow();
  });

  it("allows confirmed unpaid offline bookings before arrival", () => {
    expect(() =>
      assertGuestCancellable({
        status: "CONFIRMED",
        startDate: futureStart,
        paymentMode: "OFFLINE",
        paymentStatus: "PENDING",
      }),
    ).not.toThrow();
  });

  it("allows confirmed paid online bookings before arrival (refund duty)", () => {
    expect(() =>
      assertGuestCancellable({
        status: "CONFIRMED",
        startDate: futureStart,
        paymentMode: "ONLINE",
        paymentStatus: "PAID",
      }),
    ).not.toThrow();
  });

  it("blocks bookings once the check-in date has arrived", () => {
    expect(() =>
      assertGuestCancellable({
        status: "PENDING",
        startDate: pastStart,
        paymentMode: "OFFLINE",
        paymentStatus: "PENDING",
      }),
    ).toThrowError(ApiError);
  });

  it("blocks paid offline bookings so the refund is recorded by the admin", () => {
    expect(() =>
      assertGuestCancellable({
        status: "CONFIRMED",
        startDate: futureStart,
        paymentMode: "OFFLINE",
        paymentStatus: "PAID",
      }),
    ).toThrowError(ApiError);
  });

  it.each(["ONGOING", "COMPLETED", "CANCELLED", "REJECTED"])(
    "blocks %s bookings",
    (status) => {
      expect(() =>
        assertGuestCancellable({
          status,
          startDate: futureStart,
          paymentMode: "OFFLINE",
          paymentStatus: "PENDING",
        }),
      ).toThrowError(ApiError);
    },
  );
});

describe("assertAdminCancellable", () => {
  const futureEnd = daysFromNow(10);

  it.each(["PENDING", "CONFIRMED"])("allows %s bookings", (status) => {
    expect(() =>
      assertAdminCancellable({ status, endDate: futureEnd }),
    ).not.toThrow();
  });

  it("allows mid-stay (ONGOING) cancellations before the end date", () => {
    expect(() =>
      assertAdminCancellable({ status: "ONGOING", endDate: futureEnd }),
    ).not.toThrow();
  });

  it("blocks cancellations after the stay has ended", () => {
    expect(() =>
      assertAdminCancellable({ status: "ONGOING", endDate: daysFromNow(-3) }),
    ).toThrowError(ApiError);
  });

  it.each(["COMPLETED", "CANCELLED", "REJECTED"])(
    "blocks %s bookings",
    (status) => {
      expect(() =>
        assertAdminCancellable({ status, endDate: futureEnd }),
      ).toThrowError(ApiError);
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

describe("refund ledger", () => {
  const captured = 5600;

  it("excludes failed refunds from the refunded total", () => {
    expect(
      sumRefunds([
        { amount: 2000, status: "PROCESSED" },
        { amount: 1500, status: "FAILED" },
      ]),
    ).toBe(2000);
  });

  it("reports the remaining refundable balance", () => {
    expect(
      refundableBalance(captured, [{ amount: 600, status: "PROCESSED" }]),
    ).toBe(5000);
  });

  it("never reports a negative balance", () => {
    expect(
      refundableBalance(captured, [{ amount: 9000, status: "PROCESSED" }]),
    ).toBe(0);
  });

  it("derives NONE, PARTIAL and FULL refund state", () => {
    expect(resolveRefundState(captured, [])).toBe("NONE");
    expect(
      resolveRefundState(captured, [{ amount: 1000, status: "PROCESSED" }]),
    ).toBe("PARTIAL");
    expect(
      resolveRefundState(captured, [{ amount: 5600, status: "PROCESSED" }]),
    ).toBe("FULL");
  });

  it("rejects zero and negative amounts", () => {
    expect(() => assertRefundWithinPaid(captured, [], 0)).toThrowError(ApiError);
    expect(() => assertRefundWithinPaid(captured, [], -100)).toThrowError(
      ApiError,
    );
  });

  it("allows refunding the full captured amount", () => {
    expect(() => assertRefundWithinPaid(captured, [], 5600)).not.toThrow();
  });

  it("caps cumulatively so two partial refunds cannot exceed the capture", () => {
    const alreadyRefunded = [{ amount: 4000, status: "PROCESSED" }];

    expect(() =>
      assertRefundWithinPaid(captured, alreadyRefunded, 1600),
    ).not.toThrow();
    expect(() =>
      assertRefundWithinPaid(captured, alreadyRefunded, 1601),
    ).toThrowError(ApiError);
  });

  it("refuses further refunds once the capture is fully refunded", () => {
    const settled = [{ amount: 5600, status: "PROCESSED" }];

    expect(() => assertRefundWithinPaid(captured, settled, 1)).toThrowError(
      ApiError,
    );
  });

  it("caps against the captured amount, not the booking total", () => {
    // The guest paid 3000 of a 5600 booking: only 3000 was ever collected.
    expect(() => assertRefundWithinPaid(3000, [], 3000)).not.toThrow();
    expect(() => assertRefundWithinPaid(3000, [], 3001)).toThrowError(ApiError);
  });

  it("lets a failed refund be retried", () => {
    const failed = [{ amount: 3000, status: "FAILED" }];

    expect(() => assertRefundWithinPaid(captured, failed, 3000)).not.toThrow();
  });

  it("blocks a second refund while one is still in flight", () => {
    expect(() => assertNoRefundInFlight([])).not.toThrow();
    expect(() =>
      assertNoRefundInFlight([{ amount: 2000, status: "PROCESSED" }]),
    ).not.toThrow();
    expect(() =>
      assertNoRefundInFlight([{ amount: 500, status: "FAILED" }]),
    ).not.toThrow();

    expect(() =>
      assertNoRefundInFlight([{ amount: 2000, status: "PENDING" }]),
    ).toThrowError(/already being processed/);
  });

  it("allows refunding up to the gateway's six-month window", () => {
    const capturedAt = new Date("2026-01-15T00:00:00.000Z");

    // Exactly six months later is still inside the window; a moment past it is not.
    expect(() =>
      assertRefundWindowOpen(capturedAt, new Date("2026-07-15T00:00:00.000Z")),
    ).not.toThrow();
    expect(() =>
      assertRefundWindowOpen(
        capturedAt,
        new Date("2026-07-15T00:00:00.001Z"),
      ),
    ).toThrowError(ApiError);
  });

  it("summarizes a booking's money against the captured amount", () => {
    const summary = summarizeRefunds(
      [
        { amount: 3000, status: "PAID" },
        { amount: 2600, status: "FAILED" },
      ],
      [{ amount: 1000, status: "PROCESSED" }],
    );

    expect(summary.capturedAmount).toBe(3000);
    expect(summary.refundedAmount).toBe(1000);
    expect(summary.refundableAmount).toBe(2000);
    expect(summary.refundState).toBe("PARTIAL");
    expect(summary.refundPending).toBe(false);
    expect(summary.refundFailed).toBe(false);
  });

  it("flags in-flight and failed refunds without counting failed money", () => {
    const summary = summarizeRefunds(
      [{ amount: 5600, status: "PAID" }],
      [
        { amount: 600, status: "PENDING" },
        { amount: 5000, status: "FAILED" },
      ],
    );

    expect(summary.refundedAmount).toBe(600);
    expect(summary.refundState).toBe("PARTIAL");
    expect(summary.refundPending).toBe(true);
    expect(summary.refundFailed).toBe(true);
  });

  it("reports a fully refunded booking and tolerates unloaded relations", () => {
    const full = summarizeRefunds(
      [{ amount: 5600, status: "PAID" }],
      [{ amount: 5600, status: "PROCESSED" }],
    );
    expect(full.refundState).toBe("FULL");
    expect(full.refundableAmount).toBe(0);

    const empty = summarizeRefunds(undefined, undefined);
    expect(empty.refundState).toBe("NONE");
    expect(empty.capturedAmount).toBe(0);
    expect(empty.refundableAmount).toBe(0);
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

describe("assertBedAssignable", () => {
  const booking = { status: "CONFIRMED", roomTemplateId: "rt-1" };
  const bed = { roomTemplateId: "rt-1", deletedAt: null };

  it("assigns a matching free bed", () => {
    expect(() => assertBedAssignable(booking, bed, 0)).not.toThrow();
  });

  it("rejects beds from another room template", () => {
    expect(() =>
      assertBedAssignable(booking, { roomTemplateId: "rt-2", deletedAt: null }, 0),
    ).toThrowError(ApiError);
  });

  it("rejects deleted beds", () => {
    expect(() =>
      assertBedAssignable(booking, { roomTemplateId: "rt-1", deletedAt: new Date() }, 0),
    ).toThrowError(ApiError);
  });

  it("rejects beds with overlapping active bookings", () => {
    expect(() => assertBedAssignable(booking, bed, 1)).toThrowError(ApiError);
  });

  it.each(["COMPLETED", "CANCELLED", "REJECTED"])(
    "rejects assignments for %s bookings",
    (status) => {
      expect(() =>
        assertBedAssignable({ status, roomTemplateId: "rt-1" }, bed, 0),
      ).toThrowError(ApiError);
    },
  );
});

describe("computeProratedSettlement", () => {
  const pricePerBed = 6000;

  it("settles ten used nights of a thirty-night stay", () => {
    const settlement = computeProratedSettlement({
      totalPrice: 6000,
      startDate: daysFromNow(-10),
      endDate: daysFromNow(20),
      pricePerBed,
    });
    expect(settlement.nightsUsed).toBe(10);
    expect(settlement.amountDue).toBe(2000);
    expect(settlement.refundAmount).toBe(4000);
  });

  it("refunds nothing when every night was consumed", () => {
    const settlement = computeProratedSettlement({
      totalPrice: 6000,
      startDate: daysFromNow(-30),
      endDate: daysFromNow(5),
      pricePerBed,
    });
    expect(settlement.nightsUsed).toBe(30);
    expect(settlement.amountDue).toBe(6000);
    expect(settlement.refundAmount).toBe(0);
  });

  it("floors the refund at zero when usage exceeds the total", () => {
    const settlement = computeProratedSettlement({
      totalPrice: 6000,
      startDate: daysFromNow(-45),
      endDate: daysFromNow(5),
      pricePerBed,
    });
    expect(settlement.nightsUsed).toBe(45);
    expect(settlement.refundAmount).toBe(0);
  });
});

describe("assertDateChangeAllowed", () => {
  const booking = {
    status: "CONFIRMED",
    startDate: daysFromNow(5),
    endDate: daysFromNow(15),
  };
  const newStart = daysFromNow(7);
  const newEnd = daysFromNow(17);

  it("allows guests to reschedule before arrival", () => {
    expect(() =>
      assertDateChangeAllowed(booking, "GUEST", newStart, newEnd),
    ).not.toThrow();
  });

  it("blocks guests once the stay has started", () => {
    expect(() =>
      assertDateChangeAllowed(
        { ...booking, status: "ONGOING", startDate: daysFromNow(-3) },
        "GUEST",
        newStart,
        newEnd,
      ),
    ).toThrowError(ApiError);
  });

  it("allows admins to reschedule mid-stay", () => {
    expect(() =>
      assertDateChangeAllowed(
        { ...booking, status: "ONGOING", startDate: daysFromNow(-3) },
        "ADMIN",
        newStart,
        newEnd,
      ),
    ).not.toThrow();
  });

  it("blocks rescheduling after the stay has ended", () => {
    expect(() =>
      assertDateChangeAllowed(
        { ...booking, endDate: daysFromNow(-3) },
        "ADMIN",
        newStart,
        newEnd,
      ),
    ).toThrowError(ApiError);
  });

  it("blocks check-outs before check-ins", () => {
    expect(() =>
      assertDateChangeAllowed(booking, "GUEST", daysFromNow(17), daysFromNow(7)),
    ).toThrowError(ApiError);
  });

  it.each(["COMPLETED", "CANCELLED", "REJECTED"])(
    "blocks %s bookings",
    (status) => {
      expect(() =>
        assertDateChangeAllowed({ ...booking, status }, "ADMIN", newStart, newEnd),
      ).toThrowError(ApiError);
    },
  );
});

describe("normalizeBookingStatus", () => {
  it("advances assigned confirmed bookings past their start date to ONGOING", () => {
    expect(
      normalizeBookingStatus({
        status: "CONFIRMED",
        startDate: daysFromNow(-2),
        endDate: daysFromNow(12),
        bedId: "bed-1",
      }),
    ).toBe("ONGOING");
  });

  it("keeps unassigned confirmed bookings as CONFIRMED", () => {
    expect(
      normalizeBookingStatus({
        status: "CONFIRMED",
        startDate: daysFromNow(-2),
        endDate: daysFromNow(12),
        bedId: null,
      }),
    ).toBe("CONFIRMED");
  });

  it("completes ongoing bookings whose checkout day has passed", () => {
    expect(
      normalizeBookingStatus({
        status: "ONGOING",
        startDate: daysFromNow(-20),
        endDate: daysFromNow(-1),
        bedId: "bed-1",
      }),
    ).toBe("COMPLETED");
  });

  it("keeps ongoing bookings on their checkout morning", () => {
    expect(
      normalizeBookingStatus({
        status: "ONGOING",
        startDate: daysFromNow(-19),
        endDate: daysFromNow(0),
        bedId: "bed-1",
      }),
    ).toBe("ONGOING");
  });

  it("never moves pending bookings automatically", () => {
    expect(
      normalizeBookingStatus({
        status: "PENDING",
        startDate: daysFromNow(-5),
        endDate: daysFromNow(5),
        bedId: "bed-1",
      }),
    ).toBe("PENDING");
  });
});

describe("isActionRequired", () => {
  it("flags pending bookings past their start date", () => {
    expect(
      isActionRequired({
        status: "PENDING",
        startDate: daysFromNow(-2),
        bedId: "bed-1",
      }),
    ).toBe(true);
  });

  it("flags confirmed bookings without a bed past their start date", () => {
    expect(
      isActionRequired({
        status: "CONFIRMED",
        startDate: daysFromNow(-2),
        bedId: null,
      }),
    ).toBe(true);
  });

  it("ignores future bookings", () => {
    expect(
      isActionRequired({
        status: "PENDING",
        startDate: daysFromNow(5),
        bedId: null,
      }),
    ).toBe(false);
  });

  it("ignores assigned confirmed bookings past their start date", () => {
    expect(
      isActionRequired({
        status: "CONFIRMED",
        startDate: daysFromNow(-2),
        bedId: "bed-1",
      }),
    ).toBe(false);
  });
});
