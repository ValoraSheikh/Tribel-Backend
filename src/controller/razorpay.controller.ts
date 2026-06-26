import Razorpay from "razorpay";
import crypto from "crypto";
import { asyncHandler } from "../lib/index.ts";
import prisma from "../lib/prisma/db.ts";

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID!,
  key_secret: process.env.RAZORPAY_KEY_SECRET!,
});

export const createRazorpayOrder = asyncHandler(async (req, res) => {
  const { amount, bookingId } = req.body;

  const options = {
    amount: amount * 100,
    currency: "INR",
    receipt: `booking_${bookingId}`,
    notes: {
      bookingId: bookingId,
      userId: req.user.id,
    },
  };

  const order = await razorpay.orders.create(options);

  res.status(201).json({
    message: "Razorpay order created",
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    bookingId: bookingId,
  });
});

export const verifyRazorpayPayment = asyncHandler(async (req, res) => {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    bookingId,
    amount,
  } = req.body;

  const generated_signature = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!)
    .update(razorpay_order_id + "|" + razorpay_payment_id)
    .digest("hex");

  const isAuthentic = generated_signature === razorpay_signature;

  if (!isAuthentic) {
    return res.status(400).json({ message: "Invalid signature" });
  }

  const payment = await prisma.payment.create({
    data: {
      bookingId: bookingId,
      amount: amount * 100,
      currency: "INR",
      status: "FAILED",
      guestId: req.user.id,
      provider: "RAZORPAY",
      razorpayOrderId: razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id,
      razorpaySignature: razorpay_signature,
      metadata: {
        bookingId: bookingId,
        user: {
          userId: req.user.id,
          name: req.user.name,
          email: req.user.email,
        },
      },
    },
  });

  if (!payment) {
    return res.status(404).json({ message: "Payment not found" });
  }

  res.status(200).json({ message: "Payment verified successfully" });
});
