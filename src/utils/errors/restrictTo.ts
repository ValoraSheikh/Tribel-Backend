import type { NextFunction, Request, Response } from "express";
import ApiError from "./ApiError.js";
import asyncHandler from "../responses/asyncHandler.js";

type ReqWithUser = Request & { user?: { role: string } };

const restrictTo = (...roles: string[]) => {
  return asyncHandler(
    async (req: ReqWithUser, _res: Response, next: NextFunction) => {
      if (!req.user || !roles.includes(req.user.role)) {
        throw new ApiError("You do not have permission this action", 403);
      }
      next();
    },
  );
};

export default restrictTo;