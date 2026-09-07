import { Router } from "express";
import {
  assignBookingBed,
  cancelAdminBooking,
  cancelBooking,
  createBooking,
  getAllBooking,
  getBookingDetails,
  getBookingsForAdmin,
  getOccupancy,
  getUserBookings,
  markAdminPaymentPaid,
  recordAdminPaymentRefund,
  updateAdminBookingDates,
  updateBookingStatus,
  updateGuestBookingDates,
  updateUserBooking,
} from "../controller/booking.controller.ts";
import { restrictTo } from "../lib/index.ts";
import pkg from "express-openid-connect";
import {
  assignBedValidation,
  bookingValidation,
  bookingStatusValidation,
  markPaidValidation,
  occupancyValidation,
  refundValidation,
  updateDatesValidation,
} from "../middleware/validation.middleware.ts";
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
router.get("/user", requiresAuth(), publicGetRateLimit, getUserBookings);
router.get(
  "/occupancy/:propertyId",
  requiresAuth(),
  publicGetRateLimit,
  restrictTo("Admin", "Super_Admin"),
  occupancyValidation,
  getOccupancy,
);
router.patch(
  "/admin/:propertyId/status",
  requiresAuth(),
  bookingRateLimit,
  restrictTo("Admin", "Super_Admin"),
  bookingStatusValidation,
  updateBookingStatus,
);
router.patch(
  "/:bookingId",
  requiresAuth(),
  bookingRateLimit,
  updateUserBooking,
);
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
router.patch(
  "/admin/:propertyId/payment/paid",
  requiresAuth(),
  bookingRateLimit,
  restrictTo("Admin", "Super_Admin"),
  markPaidValidation,
  markAdminPaymentPaid,
);
router.patch(
  "/admin/:propertyId/payment/refund",
  requiresAuth(),
  bookingRateLimit,
  restrictTo("Admin", "Super_Admin"),
  refundValidation,
  recordAdminPaymentRefund,
);
router.patch(
  "/admin/:propertyId/booking/assign-bed",
  requiresAuth(),
  bookingRateLimit,
  restrictTo("Admin", "Super_Admin"),
  assignBedValidation,
  assignBookingBed,
);
router.patch(
  "/admin/:propertyId/booking/dates",
  requiresAuth(),
  bookingRateLimit,
  restrictTo("Admin", "Super_Admin"),
  updateDatesValidation,
  updateAdminBookingDates,
);
router.patch(
  "/dates",
  requiresAuth(),
  bookingRateLimit,
  updateDatesValidation,
  updateGuestBookingDates,
);

export default router;
