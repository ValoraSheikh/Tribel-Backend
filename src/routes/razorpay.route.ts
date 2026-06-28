import { Router } from "express";
import pkg from "express-openid-connect";
import {
  createRazorpayOrder,
  verifyRazorpayPayment,
  handleRazorpayWebhook,
} from "../controller/razorpay.controller.ts";
import {
  createOrderValidation,
  verifyPaymentValidation,
} from "../middleware/validation.middleware.ts";

const { requiresAuth } = pkg;

const router = Router();

router.post(
  "/create-order",
  requiresAuth(),
  createOrderValidation,
  createRazorpayOrder,
);
router.post(
  "/verify",
  requiresAuth(),
  verifyPaymentValidation,
  verifyRazorpayPayment,
);

router.post("/webhook", handleRazorpayWebhook);

export default router;
