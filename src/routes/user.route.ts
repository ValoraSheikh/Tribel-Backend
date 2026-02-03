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

router.get("/profile",  loginUser);
router.get("/signout", logout);
router.patch(
  "/profile",
  requiresAuth(),
  updateUserValidation,
  updateUserProfile,
);
router.delete("/delete", requiresAuth(), deleteUser);

export default router;
