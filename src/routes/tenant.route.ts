import { Router } from "express";
import {
  createTenant,
  getAllTenants,
  getTenantDetail,
  updateTenant,
} from "../controller/tenant.controller.ts";
import pkg from "express-openid-connect";
const { requiresAuth } = pkg;

const router = Router();

router.post("/createTenant", requiresAuth(), createTenant);
router.get("/getTenantDetail/:id", getTenantDetail);
router.get("/tenants", getAllTenants);
router.patch("/updateTenant/:id", requiresAuth(), updateTenant);

export default router;
