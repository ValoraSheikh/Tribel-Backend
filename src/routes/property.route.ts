import { Router } from "express";
import {
  createProperty,
  deleteProperty,
  getAllPropertiesForAdmin,
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
import { restrictTo } from "../utils/index.ts";
const { requiresAuth } = pkg;

const router = Router({ mergeParams: true });

router.post(
  "/",
  requiresAuth(),
  restrictTo("Admin", "Super_Admin"),
  propertyValidation,
  createProperty,
);
router.patch(
  "/:propertyId",
  requiresAuth(),
  restrictTo("Admin", "Super_Admin"),
  updatePropertyValidation,
  updateProperty,
);
router.delete(
  "/:propertyId",
  requiresAuth(),
  restrictTo("Admin", "Super_Admin"),
  deleteProperty,
);
router.get("/search", searchProperty);
router.get(
  "/",
  requiresAuth(),
  restrictTo("Admin", "Super_Admin"),
  getAllPropertiesForAdmin,
);

router.get("/:propertyId", getPropertyDetail);
router.get("/newProperty", newProperties);

export default router;
