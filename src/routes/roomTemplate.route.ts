import { Router } from "express";
import {
  createRoomTemplate,
  deleteRoomTemplate,
  getRoomTemplate,
  updateRoomTemplate,
} from "../controller/roomTemplate.controller.ts";
import pkg from "express-openid-connect";
import { roomTemplateValidation } from "../middleware/validation.middleware.ts";
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
router.get("/", getRoomTemplate);
router.patch(
  "/:roomTemplateId",
  requiresAuth(),
  restrictTo("Admin", "Super_Admin"),
  updateRoomTemplate,
);
router.delete(
  "/:roomTemplateId",
  requiresAuth(),
  restrictTo("Admin", "Super_Admin"),
  deleteRoomTemplate,
);

export default router;
