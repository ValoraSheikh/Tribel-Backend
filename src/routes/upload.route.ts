import { Router } from "express";
import pkg from "express-openid-connect";
import { deleteKey, getPresignedUploadUrl } from "../controller/upload.controller.ts";
import { uploadValidaton } from "../middleware/validation.middleware.ts";

const router = Router();

const { requiresAuth } = pkg;

router.post("/presign", requiresAuth(), uploadValidaton, getPresignedUploadUrl);
router.post("/deleteKey", requiresAuth, deleteKey);

export default router;
