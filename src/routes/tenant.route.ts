import { Router } from "express";
import {
  createTenant,
  getAllTenants,
  getTenantDetail,
  updateTenant,
} from "../controller/tenant.controller.ts";
import pkg from "express-openid-connect";
import { tenantValidation } from "../middleware/validation.middleware.ts";
import { restrictTo } from "../utils/index.ts";
const { requiresAuth } = pkg;

const router = Router({ mergeParams: true });

router.post(
  "/",
  requiresAuth(),
  restrictTo("Admin", "Super_Admin"),
  tenantValidation,
  createTenant,
);
router.get("/admin/all", restrictTo("Super_Admin"), getAllTenants);
router.get(
  "/tenantDetail/:tenantId",
  restrictTo("Admin", "Super_Admin"),
  getTenantDetail,
);
router.patch(
  "/updateTenant/:tenantId",
  restrictTo("Admin", "Super_Admin"),
  requiresAuth(),
  updateTenant,
);

export default router;
