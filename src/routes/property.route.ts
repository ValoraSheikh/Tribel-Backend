import { Router } from "express";
import {
  createProperty,
  deleteProperty,
  getAllProperties,
  getPropertyDetail,
  updateProperty,
} from "../controller/property.controller.ts";
import pkg from "express-openid-connect";
const { requiresAuth } = pkg;

const router = Router();

router.post("/:tenantId/property", requiresAuth(), createProperty);
router.patch(
  "/:tenantId/properties/:propertyId",
  requiresAuth(),
  updateProperty,
);
router.delete(
  "/:tenantId/properties/:propertyId",
  requiresAuth(),
  deleteProperty,
);
router.get("/properties/:propertyId", getPropertyDetail);
router.get("/properties", getAllProperties);

export default router;
