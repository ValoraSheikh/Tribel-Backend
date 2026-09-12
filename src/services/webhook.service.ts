import crypto from "crypto";
import prisma from "../lib/prisma/db.ts";
import { getSecuredClient } from "../lib/prisma/prisma-rls.ts";
import redis from "../lib/redis/redis-cache.ts";
import { settleRefund } from "./refund-ledger.service.ts";

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

  const computed = Buffer.from(expected, "utf8");
  const received = Buffer.from(signature ?? "", "utf8");

  // timingSafeEqual throws on a length mismatch — without this guard a garbage
  // signature header becomes a 500 on a public endpoint instead of a rejection.
  if (computed.length !== received.length) return false;

  return crypto.timingSafeEqual(computed, received);
}

async function isDuplicateEvent(eventId: string): Promise<boolean> {
  const key = `webhook:event:${eventId}`;
  const result = await redis.set(key, "1", "EX", WEBHOOK_EVENT_TTL, "NX");
  return result === null;
}

interface WebhookContext {
  userId: string;
  auth0Id: string;
  tenantId: string;
}

function extractContextFromNotes(
  notes: Record<string, any> | undefined,
): WebhookContext | null {
  if (!notes) return null;
  const { userId, auth0Id, tenantId } = notes;
  if (userId && auth0Id) {
    return {
      userId: String(userId),
      auth0Id: String(auth0Id),
      tenantId: String(tenantId || ""),
    };
  }
  return null;
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
    case "refund.processed":
    case "refund.failed":
      return await handleRefundStatusChange(payload);
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
  const bookingId = orderEntity.receipt;
  const amount = paymentEntity.amount / 100;
  const currency = paymentEntity.currency || "INR";

  if (!orderId || !paymentId) {
    console.error("Missing order_id or payment_id in order.paid payload");
    return { status: "processed", message: "Missing order_id or payment_id" };
  }

  if (!bookingId) {
    console.error(`Order ${orderId} has no receipt`);
    return { status: "processed", message: "Order has no receipt" };
  }

  const context = extractContextFromNotes(paymentEntity.notes ?? orderEntity.notes);
  if (!context) {
    console.error(`Missing webhook context for order ${orderId}`);
    return { status: "processed", message: "Missing webhook context" };
  }

  const { userId, tenantId, auth0Id } = context;
  const securedDB = getSecuredClient({
    userId,
    tenantId,
    role: "",
    auth0Id,
  });

  const existingPayment = await prisma.payment.findUnique({
    where: { razorpayOrderId: orderId },
  });

  if (existingPayment?.status === "PAID") {
    return { status: "processed", message: "Payment already captured" };
  }

    // Payment is captured, but the booking still awaits admin approval per
    // the booking policy — approval is acceptance, not money.
    await securedDB.$transaction(async (tx) => {
      await tx.payment.upsert({
        where: { razorpayOrderId: orderId },
        create: {
          bookingId,
          guestId: userId,
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
        data: { paymentStatus: "PAID", paymentMode: "ONLINE" },
      });
    });

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
  const bookingId = paymentEntity.notes?.bookingId;
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

  if (!bookingId) {
    console.error(`Payment ${paymentId} has no bookingId in notes`);
    return { status: "processed", message: "Missing booking context" };
  }

  const context = extractContextFromNotes(paymentEntity.notes);
  if (!context) {
    console.error(`Missing webhook context for order ${orderId}`);
    return { status: "processed", message: "Missing webhook context" };
  }

  const { userId, tenantId, auth0Id } = context;
  const securedDB = getSecuredClient({
    userId,
    tenantId,
    role: "",
    auth0Id,
  });

  const existingPayment = await prisma.payment.findUnique({
    where: { razorpayOrderId: orderId },
  });

  if (existingPayment?.status === "PAID") {
    return {
      status: "processed",
      message: "Payment already captured, ignoring failure",
    };
  }

  await prisma.payment.upsert({
    where: { razorpayOrderId: orderId },
    create: {
      bookingId,
      guestId: userId,
      provider: "RAZORPAY",
      status: "FAILED",
      amount,
      currency,
      razorpayOrderId: orderId,
      razorpayPaymentId: paymentId,
      failureReason,
      metadata: paymentEntity.notes || {},
    },
    update: {
      status: "FAILED",
      razorpayPaymentId: paymentId,
      failureReason,
      amount,
      currency,
      metadata: paymentEntity.notes || {},
    },
  });

  await securedDB.booking.updateMany({
    where: { id: bookingId, paymentStatus: "PENDING" },
    data: { paymentStatus: "FAILED" },
  });

  return { status: "processed", message: "Payment failed recorded" };
}

/**
 * Razorpay refund lifecycle: a refund starts as PENDING when we call the gateway
 * and settles asynchronously. Only the ledger row's own status changes here —
 * refund state is derived on read, and the booking's paymentStatus keeps
 * describing what the guest PAID. Settlement is delegated to the shared ledger
 * writer so the webhook and the reconciliation sweep cannot disagree, and a
 * refund the gateway knows about but we never recorded is recovered rather than
 * dropped. A replayed webhook is a no-op.
 */
async function handleRefundStatusChange(
  payload: Record<string, any>,
): Promise<{
  status: "processed"; message: string
}> {
  const refundEntity = payload.payload?.refund?.entity;
  if (!refundEntity?.id) {
    console.error("Missing refund entity in refund webhook payload");
    return { status: "processed", message: "Missing refund entity" };
  }

  const result = await settleRefund({
    providerRefundId: String(refundEntity.id),
    outcome: payload.event === "refund.processed" ? "PROCESSED" : "FAILED",
    gatewayPaymentId: refundEntity.payment_id ?? null,
    amount:
      typeof refundEntity.amount === "number" ? refundEntity.amount / 100 : null,
    reason:
      refundEntity.error_description ?? refundEntity.error_reason ?? null,
  });

  return { status: "processed", message: result.message };
}
