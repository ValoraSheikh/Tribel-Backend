import { Router } from "express";
import {
  createRoomTemplate,
  deleteRoomTemplate,
  getRoomTemplate,
  updateRoomTemplate,
} from "../controller/roomTemplate.controller.ts";
import pkg from "express-openid-connect";
import { roomTemplateValidation } from "../middleware/validation.middleware.ts";
const { requiresAuth } = pkg;

const router = Router();

router.post(
  "/:propertyId/roomTemplate",
  requiresAuth(),
  roomTemplateValidation,
  createRoomTemplate,
);
router.get("/:propertyId", getRoomTemplate);
router.patch(
  "/:propertyId/roomTemplate/:roomTemplateId",
  requiresAuth(),
  updateRoomTemplate,
);
router.delete(
  "/:propertyId/roomTemplate/:roomTemplateId",
  requiresAuth(),
  deleteRoomTemplate,
);

export default router;
