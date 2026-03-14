import { Router } from "express";
import {
  createRoomTemplate,
  deleteRoomTemplate,
  getRoomTemplateDetail,
  getRoomTemplates,
  updateRoomTemplate,
} from "../controller/roomTemplate.controller.ts";
import pkg from "express-openid-connect";
import {
  roomTemplateValidation,
  updateRoomTemplateValidation,
} from "../middleware/validation.middleware.ts";
import { restrictTo } from "../lib/index.ts";
import {
  publicGetRateLimit,
  roomTemplateRateLimit,
} from "../middleware/rate-limit.middleware.ts";
const { requiresAuth } = pkg;

const router = Router({ mergeParams: true });

router.post(
  "/",
  requiresAuth(),
  roomTemplateRateLimit,
  restrictTo("Admin", "Super_Admin"),
  roomTemplateValidation,
  createRoomTemplate,
);
router.get("/", publicGetRateLimit, getRoomTemplates);
router.patch(
  "/:roomTemplateId",
  requiresAuth(),
  roomTemplateRateLimit,
  restrictTo("Admin", "Super_Admin"),
  updateRoomTemplateValidation,
  updateRoomTemplate,
);
router.delete(
  "/:roomTemplateId",
  requiresAuth(),
  roomTemplateRateLimit,
  restrictTo("Admin", "Super_Admin"),
  deleteRoomTemplate,
);
router.get("/:roomTemplateId", publicGetRateLimit, getRoomTemplateDetail);

export default router;
