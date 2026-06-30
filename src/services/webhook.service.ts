import crypto from "crypto";
import Razorpay from "razorpay";
import adminDB from "../lib/prisma/admin-db.ts";
import redis from "../lib/redis/redis-cache.ts";
import rabbitmq from "../lib/rabbitmq/config/rabbitmq.ts";

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID!,
  key_secret: process.env.RAZORPAY_KEY_SECRET!,
});

const WEBHOOK_EVENT_TTL = 60 * 60 * 24 * 7;

export function verifyWebhookSignature(
  rawBody: Buffer,
  signature: string,
  secret: string,
): boolean {
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody.toString())
    .digest("hex");

  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

async function isDuplicateEvent(eventId: string): Promise<boolean> {
  const key = `webhook:event:${eventId}`;
  const result = await redis.set(key, "1", "EX", WEBHOOK_EVENT_TTL, "NX");
  return result === null;
}

export async function processWebhookEvent(
  eventId: string,
  payload: Record<string, any>,
): Promise<{
  status: "processed" | "duplicate" | "unrecognized";
  message: string;
}> {
  const duplicate = await isDuplicateEvent(eventId);
  if (duplicate) {
    return { status: "duplicate", message: "Event already processed" };
  }

  switch (payload.event) {
    case "order.paid":
      return await handleOrderPaid(payload);
    case "payment.failed":
      return await handlePaymentFailed(payload);
    default:
      return {
        status: "unrecognized",
        message: `Unrecognized event type: ${payload.event}`,
      };
  }
}

async function handleOrderPaid(
  payload: Record<string, any>,
): Promise<{
  status: "processed";
  message: string;
}> {
  const paymentEntity = payload.payload?.payment?.entity;
  const orderEntity = payload.payload?.order?.entity;

  if (!paymentEntity || !orderEntity) {
    console.error("Missing payment or order entity in order.paid payload");
    return { status: "processed", message: "Missing entities in payload" };
  }

  const orderId = orderEntity.id;
  const paymentId = paymentEntity.id;
  const amount = paymentEntity.amount / 100;
  const currency = paymentEntity.currency || "INR";

  if (!orderId || !paymentId) {
    console.error("Missing order_id or payment_id in order.paid payload");
    return { status: "processed", message: "Missing order_id or payment_id" };
  }

  let bookingId: string;
  let guestId: string;

  const existingPayment = await adminDB.payment.findUnique({
    where: { razorpayOrderId: orderId },
  });

  if (existingPayment) {
    bookingId = existingPayment.bookingId;
    guestId = existingPayment.guestId;
  } else {
    bookingId = orderEntity.receipt;
    if (!bookingId) {
      console.error(`Order ${orderId} has no receipt`);
      return { status: "processed", message: "Order has no receipt" };
    }

    const booking = await adminDB.booking.findUnique({
      where: { id: bookingId },
      select: { guestId: true },
    });
    guestId = booking?.guestId || "";
    if (!guestId) {
      console.error(`Booking ${bookingId} not found for order.paid`);
      return { status: "processed", message: "Booking not found" };
    }
  }

  await adminDB.$transaction(async (tx) => {
    await tx.payment.upsert({
      where: { razorpayOrderId: orderId },
      create: {
        bookingId,
        guestId,
        provider: "RAZORPAY",
        status: "PAID",
        amount,
        currency,
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        paidAt: new Date(),
        metadata: paymentEntity.notes || {},
      },
      update: {
        status: "PAID",
        razorpayPaymentId: paymentId,
        paidAt: new Date(),
        amount,
        currency,
        metadata: paymentEntity.notes || {},
        failureReason: null,
      },
    });

    await tx.booking.update({
      where: { id: bookingId, paymentStatus: "PENDING" },
      data: {
        paymentStatus: "PAID",
        status: "CONFIRMED",
        paymentMode: "ONLINE",
      },
    });
  });

  try {
    await rabbitmq({
      msg: JSON.stringify({ bookingId, paymentId }),
      exchange: "tribel.events",
      routingKey: "invoice",
    });

    await rabbitmq({
      msg: JSON.stringify({ bookingId, paymentId }),
      exchange: "tribel.events",
      routingKey: "email",
    });
  } catch (err) {
    console.error("Failed to emit events for booking", bookingId, err);
  }

  return { status: "processed", message: "Payment captured successfully" };
}

async function handlePaymentFailed(
  payload: Record<string, any>,
): Promise<{
  status: "processed";
  message: string;
}> {
  const paymentEntity = payload.payload?.payment?.entity;
  if (!paymentEntity) {
    console.error("Missing payment entity in payment.failed payload");
    return { status: "processed", message: "Missing payment entity" };
  }

  const orderId = paymentEntity.order_id;
  const paymentId = paymentEntity.id;
  const amount = paymentEntity.amount / 100;
  const currency = paymentEntity.currency || "INR";
  const failureReason =
    paymentEntity.error_description ||
    paymentEntity.error_reason ||
    "Payment failed";

  if (!orderId || !paymentId) {
    console.error("Missing order_id or payment_id in payment.failed payload");
    return { status: "processed", message: "Missing order_id or payment_id" };
  }

  let bookingId: string;
  let guestId: string;

  const existingPayment = await adminDB.payment.findUnique({
    where: { razorpayOrderId: orderId },
  });

  if (existingPayment) {
    if (existingPayment.status === "PAID") {
      return {
        status: "processed",
        message: "Payment already captured, ignoring failure",
      };
    }
    bookingId = existingPayment.bookingId;
    guestId = existingPayment.guestId;
  } else {
    try {
      const razorpayOrder = await razorpay.orders.fetch(orderId);
      const receipt = razorpayOrder.receipt;
      if (!receipt) {
        console.error(`Razorpay order ${orderId} has no receipt`);
        return { status: "processed", message: "Order has no receipt" };
      }
      bookingId = receipt;

      const booking = await adminDB.booking.findUnique({
        where: { id: bookingId },
        select: { guestId: true, paymentStatus: true },
      });

      if (!booking) {
        console.error(`Booking ${bookingId} not found for payment.failed`);
        return { status: "processed", message: "Booking not found" };
      }

      if (booking.paymentStatus === "PAID") {
        return {
          status: "processed",
          message: "Booking already paid, ignoring failure",
        };
      }

      guestId = booking.guestId;
    } catch (err) {
      console.error(`Failed to fetch Razorpay order ${orderId}:`, err);
      return { status: "processed", message: "Failed to fetch Razorpay order" };
    }
  }

  await adminDB.$transaction(async (tx) => {
    const currentPayment = await tx.payment.findUnique({
      where: { razorpayOrderId: orderId },
    });

    if (!currentPayment) {
      await tx.payment.create({
        data: {
          bookingId,
          guestId,
          provider: "RAZORPAY",
          status: "FAILED",
          amount,
          currency,
          razorpayOrderId: orderId,
          razorpayPaymentId: paymentId,
          failureReason,
          metadata: paymentEntity.notes || {},
        },
      });
    } else if (currentPayment.status !== "PAID") {
      await tx.payment.update({
        where: { razorpayOrderId: orderId },
        data: {
          status: "FAILED",
          razorpayPaymentId: paymentId,
          failureReason,
          amount,
          currency,
          metadata: paymentEntity.notes || {},
        },
      });
    }

    await tx.booking.update({
      where: { id: bookingId, paymentStatus: "PENDING" },
      data: { paymentStatus: "FAILED" },
    });
  });

  return { status: "processed", message: "Payment failed recorded" };
}
