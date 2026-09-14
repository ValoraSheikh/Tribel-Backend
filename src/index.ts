import "./instrumentation.ts";
import type { NextFunction, Request, Response } from "express";
import dotenv from "dotenv";
import { app } from "./app.ts";
import emailConsumer from "./lib/rabbitmq/consumers/email.consumer.ts";
import invoiceConsumer from "./lib/rabbitmq/consumers/invoice.consumer.ts";
import { startBookingLifecycleCron } from "./jobs/booking-lifecycle.job.ts";
import { startRefundReconciliationCron } from "./jobs/refund-reconciliation.job.ts";
import logger from "./lib/logger.ts";

dotenv.config({ path: "./.env" });
const port = process.env.PORT;

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || "Internal Server Error";
  logger.error({ err }, "Unhandled error");
  return res.status(statusCode).json({
    status: statusCode,
    message: message,
  });
});

app.listen(port, () => {
  logger.info(`Server is running on port ${port}`);
});

startBookingLifecycleCron();
startRefundReconciliationCron();

emailConsumer().catch((err) => logger.error({ err }, "Email consumer failed to start"));
invoiceConsumer().catch((err) => logger.error({ err }, "Invoice consumer failed to start"));
