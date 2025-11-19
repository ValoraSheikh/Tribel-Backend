import { Router } from "express";
import {
  cancelBooking,
  createBooking,
  getAllBooking,
  getUserBookings,
  getUserBookingsForAdmin,
} from "../controller/booking.controller.ts";
import { restrictTo } from "../utils/index.ts";
import pkg from "express-openid-connect";
import { bookingValidation } from "../middleware/validation.middleware.ts";

const { requiresAuth } = pkg;

const router = Router({ mergeParams: true });

router.post("/:propertyId", requiresAuth(), bookingValidation, createBooking);
router.delete("/", cancelBooking);
router.get("/user", getUserBookings);
router.get(
  "/",
  requiresAuth(),
  restrictTo("Admin", "Super_Admin"),
  getUserBookingsForAdmin,
);
router.get(
  "/admin/all",
  requiresAuth(),
  restrictTo("Super_Admin"),
  getAllBooking,
);

export default router;
