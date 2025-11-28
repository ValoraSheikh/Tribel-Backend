import { Router } from "express";
import {
  deleteUser,
  loginUser,
  logout,
  updateUserProfile,
} from "../controller/user.controller.ts";
import pkg from "express-openid-connect";
import {
  updateUserValidation,
  userValidation,
} from "../middleware/validation.middleware.ts";
const { requiresAuth } = pkg;

const router = Router();

router.get("/profile", requiresAuth(), loginUser);
router.get("/signout", requiresAuth(), logout);
router.patch(
  "/updateUserProfile",
  requiresAuth(),
  updateUserValidation,
  updateUserProfile,
);
router.delete("/deleteUser", requiresAuth(), deleteUser);

export default router;
