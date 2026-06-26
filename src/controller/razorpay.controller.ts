import Razorpay from "razorpay";
import crypto from "crypto";
import { ApiError, ApiResponse, asyncHandler } from "../lib/index.ts";
import prisma from "../lib/prisma/db.ts";
import rabbitmq from "../lib/rabbitmq/config/rabbitmq.ts";

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID!,
  key_secret: process.env.RAZORPAY_KEY_SECRET!,
});

export const createRazorpayOrder = asyncHandler(async (req, res) => {
  const { bookingId } = req.body;

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { property: true },
  });

  if (!booking) {
    throw new ApiError("Booking not found", 404);
  }

  if (booking.guestId !== req.user.id) {
    throw new ApiError("Forbidden", 403);
  }

  if (booking.paymentStatus === "PAID") {
    throw new ApiError("Booking is already paid", 409);
  }

  const existingPayment = await prisma.payment.findFirst({
    where: { bookingId, status: "PAID" },
  });

  if (existingPayment) {
    throw new ApiError("Payment already completed for this booking", 409);
  }

  const amountInPaise = Number(booking.totalPrice) * 100;

  const options = {
    amount: amountInPaise,
    currency: "INR",
    receipt: `booking_${bookingId}`,
    notes: {
      bookingId: bookingId,
      userId: req.user.id,
    },
  };

  const order = await razorpay.orders.create(options);

  res.status(201).json(
    new ApiResponse(
      {
        orderId: order.id,
        amount: Number(booking.totalPrice),
        currency: order.currency,
        bookingId: bookingId,
      },
      "Razorpay order created",
      201,
    ),
  );
});

export const verifyRazorpayPayment = asyncHandler(async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, bookingId } = req.body;

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
  });

  if (!booking) {
    throw new ApiError("Booking not found", 404);
  }

  if (booking.guestId !== req.user.id) {
    throw new ApiError("Forbidden", 403);
  }

  const existingPayment = await prisma.payment.findUnique({
    where: { razorpayOrderId: razorpay_order_id },
  });

  if (existingPayment) {
    if (existingPayment.status === "PAID") {
      return res
        .status(200)
        .json(new ApiResponse(existingPayment, "Payment already verified", 200));
    }
    throw new ApiError("Payment previously failed. Create a new order to retry.", 400);
  }

  const generatedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!)
    .update(razorpay_order_id + "|" + razorpay_payment_id)
    .digest("hex");

  const isAuthentic = generatedSignature === razorpay_signature;

  if (!isAuthentic) {
    await prisma.payment.create({
      data: {
        bookingId,
        guestId: req.user.id,
        provider: "RAZORPAY",
        status: "FAILED",
        amount: booking.totalPrice,
        currency: "INR",
        razorpayOrderId: razorpay_order_id,
        razorpayPaymentId: razorpay_payment_id,
        razorpaySignature: razorpay_signature,
        failureReason: "Invalid signature",
        metadata: {
          user: { userId: req.user.id, name: req.user.name, email: req.user.email },
        },
      },
    });

    return res.status(400).json(new ApiResponse(null, "Invalid payment signature", 400));
  }

  const payment = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        bookingId,
        guestId: req.user.id,
        provider: "RAZORPAY",
        status: "PAID",
        amount: booking.totalPrice,
        currency: "INR",
        razorpayOrderId: razorpay_order_id,
        razorpayPaymentId: razorpay_payment_id,
        razorpaySignature: razorpay_signature,
        paidAt: new Date(),
        metadata: {
          user: { userId: req.user.id, name: req.user.name, email: req.user.email },
        },
      },
    });

    await tx.booking.update({
      where: { id: bookingId },
      data: { paymentStatus: "PAID" },
    });

    return payment;
  });

  // try {
  //   await rabbitmq({
  //     msg: JSON.stringify({
  //       title: "Payment Confirmed",
  //       email: req.user.email,
  //       body: `Payment of ₹${booking.totalPrice} for booking ${bookingId} confirmed.`,
  //       invoice: bookingId,
  //     }),
  //     exchange: "tribel.events",
  //     routingKey: "invoice",
  //   });
  // } catch {
  //   console.error("Failed to emit invoice event for booking", bookingId);
  // }

  res.status(200).json(
    new ApiResponse(
      {
        payment,
        bookingId,
        redirect: "bookings",
      },
      "Payment verified successfully",
      200,
    ),
  );
});
