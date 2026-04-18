import { Router } from "express";
import {
  createTenant,
  getAllTenants,
  getTenantDetail,
  updateTenant,
  updateTenantProfile,
} from "../controller/tenant.controller.ts";
import pkg from "express-openid-connect";
import {
  tenantValidation,
  updateTenantValidation,
} from "../middleware/validation.middleware.ts";
import { restrictTo } from "../lib/index.ts";
import {
  publicGetRateLimit,
  tenantRateLimit,
} from "../middleware/rate-limit.middleware.ts";
const { requiresAuth } = pkg;

const router = Router({ mergeParams: true });

router.post(
  "/",
  requiresAuth(),
  tenantRateLimit,
  tenantValidation,
  createTenant,
);
router.get(
  "/admin/all",
  requiresAuth(),
  publicGetRateLimit,
  restrictTo("Super_Admin"),
  getAllTenants,
);
router.get(
  "/",
  requiresAuth(),
  publicGetRateLimit,
  restrictTo("Admin", "Super_Admin"),
  getTenantDetail,
);
router.patch(
  "/",
  requiresAuth(),
  tenantRateLimit,
  restrictTo("Admin", "Super_Admin"),
  updateTenantValidation,
  updateTenant,
);
router.patch("/profile", requiresAuth(), updateTenantProfile);

export default router;
