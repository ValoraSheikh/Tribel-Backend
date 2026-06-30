import { Router } from "express";
import {
  deleteUser,
  loginUser,
  logout,
  updateAvatar,
  updateUserProfile,
} from "../controller/user.controller.ts";
import pkg from "express-openid-connect";
import {
  updateUserValidation,
} from "../middleware/validation.middleware.ts";
import {
  publicGetRateLimit,
  userRateLimit,
} from "../middleware/rate-limit.middleware.ts";
const { requiresAuth } = pkg;

const router = Router();

router.get("/profile", publicGetRateLimit, loginUser);
router.get("/signout", logout);
router.patch(
  "/profile",
  requiresAuth(),
  userRateLimit,
  updateUserValidation,
  updateUserProfile,
);
router.patch("/avatar", updateAvatar);
router.delete("/delete", requiresAuth(), userRateLimit, deleteUser);

export default router;
