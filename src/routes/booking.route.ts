import { Router } from "express";
import {
  cancelBooking,
  createBooking,
  getAllBooking,
  getBookingsForAdmin,
  getUserBookings,
  updateUserBooking,
} from "../controller/booking.controller.ts";
import { restrictTo } from "../utils/index.ts";
import pkg from "express-openid-connect";
import { bookingValidation } from "../middleware/validation.middleware.ts";

const { requiresAuth } = pkg;

const router = Router({ mergeParams: true });

router.post("/:propertyId", requiresAuth(), bookingValidation, createBooking);
router.patch("/", requiresAuth(), cancelBooking);
router.patch("/:bookingId", requiresAuth(), updateUserBooking);
router.get("/user", requiresAuth(), getUserBookings);
router.get(
  "/",
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

export default router;
