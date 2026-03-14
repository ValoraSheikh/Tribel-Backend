import { Router } from "express";
import {
  cancelAdminBooking,
  cancelBooking,
  createBooking,
  getAllBooking,
  getBookingDetails,
  getBookingsForAdmin,
  getUserBookings,
  updateUserBooking,
} from "../controller/booking.controller.ts";
import { restrictTo } from "../lib/index.ts";
import pkg from "express-openid-connect";
import { bookingValidation } from "../middleware/validation.middleware.ts";
import {
  bookingRateLimit,
  publicGetRateLimit,
} from "../middleware/rate-limit.middleware.ts";

const { requiresAuth } = pkg;

const router = Router({ mergeParams: true });

router.post(
  "/",
  requiresAuth(),
  bookingRateLimit,
  bookingValidation,
  createBooking,
);
router.patch("/", requiresAuth(), bookingRateLimit, cancelBooking);
router.patch(
  "/:bookingId",
  requiresAuth(),
  bookingRateLimit,
  updateUserBooking,
);
router.get("/user", requiresAuth(), publicGetRateLimit, getUserBookings);
router.get(
  "/:propertyId",
  requiresAuth(),
  publicGetRateLimit,
  restrictTo("Admin", "Super_Admin"),
  getBookingsForAdmin,
);
router.get(
  "/admin/all",
  requiresAuth(),
  publicGetRateLimit,
  restrictTo("Super_Admin"),
  getAllBooking,
);
router.get(
  "/:bookingId",
  requiresAuth(),
  publicGetRateLimit,
  restrictTo("Admin", "Super_Admin"),
  getBookingDetails,
);
router.patch(
  "/admin/:propertyId",
  requiresAuth(),
  restrictTo("Admin", "Super_Admin"),
  cancelAdminBooking,
);

export default router;
