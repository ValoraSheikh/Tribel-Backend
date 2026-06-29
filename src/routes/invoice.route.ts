import { Router } from "express";
import pkg from "express-openid-connect";
import { getInvoiceByBooking, getUserInvoices } from "../controller/invoice.controller.ts";

const { requiresAuth } = pkg;

const router = Router();

router.get("/", requiresAuth(), getUserInvoices);
router.get("/:bookingId", requiresAuth(), getInvoiceByBooking);

export default router;
