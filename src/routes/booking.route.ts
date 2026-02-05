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

const { requiresAuth } = pkg;

const router = Router({ mergeParams: true });

router.post("/", requiresAuth(), bookingValidation, createBooking);
router.patch("/", requiresAuth(), cancelBooking);
router.patch("/:bookingId", requiresAuth(), updateUserBooking);
router.get("/user", requiresAuth(), getUserBookings);
router.get(
  "/:propertyId",
  requiresAuth(),
  restrictTo("Admin", "Super_Admin"),
  getBookingsForAdmin,
);
router.get(
  "/admin/all",
  requiresAuth(),
  restrictTo("Super_Admin"),
  getAllBooking,
);
router.get(
  "/:bookingId",
  requiresAuth(),
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
