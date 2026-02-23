import type { NextFunction, Request, Response } from "express";
import ApiError from "./ApiError.ts";
import { asyncHandler } from "../index.ts";

type ReqWithUser = Request & { user?: { role: string } };

const restrictTo = (...roles: string[]) => {
  return asyncHandler(
    async (req: ReqWithUser, _res: Response, next: NextFunction) => {
      if (!req.user || !roles.includes(req.user.role)) {
        throw new ApiError("You do not have permission for this action", 403);
      }
      next();
    },
  );
};

export default restrictTo;
