import { Router } from "express";
import pkg from "express-openid-connect";
import { getPresignedUploadUrl } from "../controller/upload.controller.ts";
import { uploadValidaton } from "../middleware/validation.middleware.ts";

const router = Router();

const { requiresAuth } = pkg;

router.post("/presign", requiresAuth(), uploadValidaton, getPresignedUploadUrl);

export default router;
