import { Router } from "express";
import {
  deleteUser,
  loginUser,
  logout,
  updateUserProfile,
} from "../controller/user.controller.ts";
import pkg from "express-openid-connect";
const { requiresAuth } = pkg;

const router = Router();

router.get("/profile", requiresAuth(), loginUser);
router.get("/signout", requiresAuth(), logout);
router.patch("/updateUserProfile", requiresAuth(), updateUserProfile);
router.delete("/deleteUser", requiresAuth(), deleteUser);

export default router;
