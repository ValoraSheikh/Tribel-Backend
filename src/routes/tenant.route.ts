import { Router } from "express";
import {
  createTenant,
  getAllTenants,
  getTenantDetail,
  updateTenant,
} from "../controller/tenant.controller.ts";
import pkg from "express-openid-connect";
import {
  tenantValidation,
  updateTenantValidation,
} from "../middleware/validation.middleware.ts";
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
router.get(
  "/admin/all",
  requiresAuth(),
  restrictTo("Super_Admin"),
  getAllTenants,
);
router.get(
  "/:tenantId",
  requiresAuth(),
  restrictTo("Admin", "Super_Admin"),
  getTenantDetail,
);
router.patch(
  "/:tenantId",
  requiresAuth(),
  restrictTo("Admin", "Super_Admin"),
  updateTenantValidation,
  updateTenant,
);

export default router;
