import Razorpay from "razorpay";
import crypto from "crypto";
import { ApiError, ApiResponse, asyncHandler } from "../lib/index.ts";
import prisma from "../lib/prisma/db.ts";
import { getSecuredClient } from "../lib/prisma/prisma-rls.ts";
import {
  verifyWebhookSignature,
  processWebhookEvent,
} from "../services/webhook.service.ts";

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID!,
  key_secret: process.env.RAZORPAY_KEY_SECRET!,
});

export const createRazorpayOrder = asyncHandler(async (req, res) => {
  const { bookingId } = req.body;

  console.log("Booking id", bookingId);

  const securedDB = getSecuredClient({
    userId: req.user.id,
    tenantId: "",
    role: "",
    auth0Id: req.oidc.user?.sub,
  });

  const booking = await securedDB.booking.findUnique({
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

  const existingPayment = await securedDB.payment.findFirst({
    where: { bookingId, status: "PAID" },
  });

  if (existingPayment) {
    throw new ApiError("Payment already completed for this booking", 409);
  }

  const amountInPaise = Number(booking.totalPrice) * 100;

  const options = {
    amount: amountInPaise,
    currency: "INR",
    receipt: `${bookingId}`,
    notes: {
      bookingId: bookingId,
      userId: req.user.id,
      auth0Id: req.oidc.user?.sub ?? "",
      tenantId: booking.property?.tenantId ?? "",
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
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    bookingId,
  } = req.body;

  const securedDB = getSecuredClient({
    userId: req.user.id,
    tenantId: "",
    role: "",
    auth0Id: req.oidc.user?.sub,
  });

  const booking = await securedDB.booking.findUnique({
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
        .json(
          new ApiResponse(existingPayment, "Payment already verified", 200),
        );
    }
    throw new ApiError(
      "Payment previously failed. Create a new order to retry.",
      400,
    );
  }

  const generatedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!)
    .update(razorpay_order_id + "|" + razorpay_payment_id)
    .digest("hex");

  const isAuthentic = generatedSignature === razorpay_signature;

  if (!isAuthentic) {
    await securedDB.booking.update({
      where: {
        id: bookingId,
      },
      data: {
        status: "CANCELLED",
      },
    });
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
          user: {
            userId: req.user.id,
            name: req.user.name,
            email: req.user.email,
          },
        },
      },
    });

    return res
      .status(400)
      .json(new ApiResponse(null, "Invalid payment signature", 400));
  }

  const payment = await securedDB.$transaction(async (tx) => {
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
          user: {
            userId: req.user.id,
            name: req.user.name,
            email: req.user.email,
          },
        },
      },
    });

    await tx.booking.update({
      where: { id: bookingId },
      data: {
        paymentStatus: "PAID",
        paymentMode: "ONLINE",
        status: "CONFIRMED",
      },
    });

    return payment;
  });

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

export const handleRazorpayWebhook = asyncHandler(async (req, res) => {
  const signature = req.headers["x-razorpay-signature"] as string | undefined;
  const eventId = req.headers["x-razorpay-event-id"] as string | undefined;
  const rawBody = req.rawBody;

  if (!signature) {
    throw new ApiError("Missing X-Razorpay-Signature header", 400);
  }
  if (!eventId) {
    throw new ApiError("Missing X-Razorpay-Event-Id header", 400);
  }
  if (!rawBody) {
    throw new ApiError("Missing raw request body", 400);
  }

  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("RAZORPAY_WEBHOOK_SECRET is not configured");
    throw new ApiError("Webhook configuration error", 500);
  }

  const isValid = verifyWebhookSignature(rawBody, signature, webhookSecret);
  if (!isValid) {
    console.warn("Invalid webhook signature received");
    throw new ApiError("Invalid signature", 400);
  }

  const payload = req.body;
  console.log(`Webhook event received: ${payload.event} (id: ${eventId})`);

  const result = await processWebhookEvent(eventId, payload);

  res.status(200).json(new ApiResponse(null, result.message, 200));
});
