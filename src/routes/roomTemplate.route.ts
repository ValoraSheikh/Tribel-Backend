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
import { restrictTo } from "../utils/index.ts";
const { requiresAuth } = pkg;

const router = Router({ mergeParams: true });

router.post(
  "/",
  requiresAuth(),
  restrictTo("Admin", "Super_Admin"),
  roomTemplateValidation,
  createRoomTemplate,
);
router.get("/", getRoomTemplates);
router.patch(
  "/:roomTemplateId",
  requiresAuth(),
  restrictTo("Admin", "Super_Admin"),
  updateRoomTemplateValidation,
  updateRoomTemplate,
);
router.delete(
  "/:roomTemplateId",
  requiresAuth(),
  restrictTo("Admin", "Super_Admin"),
  deleteRoomTemplate,
);
router.get("/:roomTemplateId", getRoomTemplateDetail)

export default router;
