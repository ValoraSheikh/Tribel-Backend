import { Router } from "express";
import {
  createProperty,
  deleteProperty,
  getAllProperties,
  getPropertyDetail,
  updateProperty,
} from "../controller/property.controller.ts";
import pkg from "express-openid-connect";
import { propertyValidation } from "../middleware/validation.middleware.ts";
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
  updateProperty,
);
router.delete(
  "/:propertyId",
  requiresAuth(),
  restrictTo("Admin", "Super_Admin"),
  deleteProperty,
);
router.get("/:propertyId", getPropertyDetail);
router.get("/", getAllProperties);

export default router;
