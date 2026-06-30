import { Router } from "express";
import pkg from "express-openid-connect";
import {
  getAdminInvoiceByBooking,
  getInvoiceByBooking,
  getUserInvoices,
} from "../controller/invoice.controller.ts";
import { restrictTo } from "../lib/index.ts";
import { publicGetRateLimit } from "../middleware/rate-limit.middleware.ts";

const { requiresAuth } = pkg;

const router = Router();

router.get("/", requiresAuth(), getUserInvoices);
router.get(
  "/admin/:bookingId",
  requiresAuth(),
  publicGetRateLimit,
  restrictTo("Admin", "Super_Admin"),
  getAdminInvoiceByBooking,
);
router.get("/:bookingId", requiresAuth(), getInvoiceByBooking);

export default router;
