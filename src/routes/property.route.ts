import { Router } from "express";
import {
  createProperty,
  deleteProperty,
  getAdminProperties,
  getBookingData,
  getPropertyDetail,
  newProperties,
  searchProperty,
  updateProperty,
} from "../controller/property.controller.ts";
import pkg from "express-openid-connect";
import {
  propertyValidation,
  updatePropertyValidation,
} from "../middleware/validation.middleware.ts";
import { restrictTo } from "../lib/index.ts";
import {
  propertyRateLimit,
  publicGetRateLimit,
} from "../middleware/rate-limit.middleware.ts";
const { requiresAuth } = pkg;

const router = Router({ mergeParams: true });

router.post(
  "/",
  requiresAuth(),
  propertyRateLimit,
  restrictTo("Admin", "Super_Admin"),
  propertyValidation,
  createProperty,
);
router.patch(
  "/:propertyId",
  requiresAuth(),
  propertyRateLimit,
  restrictTo("Admin", "Super_Admin"),
  updatePropertyValidation,
  updateProperty,
);
router.delete(
  "/:propertyId",
  requiresAuth(),
  propertyRateLimit,
  restrictTo("Admin", "Super_Admin"),
  deleteProperty,
);
router.get("/search", publicGetRateLimit, searchProperty);
router.get(
  "/",
  requiresAuth(),
  publicGetRateLimit,
  restrictTo("Admin", "Super_Admin"),
  getAdminProperties,
);

router.get("/newProperty", publicGetRateLimit, newProperties);
router.get("/:propertyId/booking-data", publicGetRateLimit, getBookingData);
router.get("/:propertyId", publicGetRateLimit, getPropertyDetail);

export default router;
