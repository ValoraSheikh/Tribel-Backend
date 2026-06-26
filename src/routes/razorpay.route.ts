import { Router } from "express";
// import { requiresAuth } from "express-openid-connect";
import {
  createRazorpayOrder,
  verifyRazorpayPayment,
} from "../controller/razorpay.controller.ts";
import {
  createOrderValidation,
  verifyPaymentValidation,
} from "../middleware/validation.middleware.ts";

const router = Router();

router.post(
  "/create-order",
  // requiresAuth(),
  createOrderValidation,
  createRazorpayOrder,
);
router.post(
  "/verify",
  // requiresAuth(),
  verifyPaymentValidation,
  verifyRazorpayPayment,
);

export default router;
