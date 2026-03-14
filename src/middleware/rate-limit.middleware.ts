import type { NextFunction, Request, Response } from "express";
import { attempt } from "../lib/redis/redis-rate-limit.ts";
import { ApiError } from "../lib/index.ts";

export function rateLimit(config?: {
  maxRequests?: number;
  windowSeconds?: number;
  keyPrefix?: string;
}) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const identifier = req.user?.id ?? req.ip;
      const key = `${config?.keyPrefix ?? "rate"}:${identifier}`;

      const result = await attempt(key, {
        maxRequests: config?.maxRequests ?? 100,
        windowSeconds: config?.windowSeconds ?? 60,
      });

      res.setHeader("X-RateLimit-Limit", result.limit);
      res.setHeader("X-RateLimit-Remaining", result.remaining);

      if (!result.allowed) {
        res.setHeader("Retry-After", result.retryAfter ?? 0);
        throw new ApiError(
          `Too many Request please retry after ${result.retryAfter} seconds`,
          429,
        );
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

export const userRateLimit = rateLimit({
  maxRequests: 30,
  windowSeconds: 60,
  keyPrefix: "api:users",
});

export const tenantRateLimit = rateLimit({
  maxRequests: 100,
  windowSeconds: 60,
  keyPrefix: "api:tenants",
});

export const propertyRateLimit = rateLimit({
  maxRequests: 100,
  windowSeconds: 60,
  keyPrefix: "api:properties",
});

export const roomTemplateRateLimit = rateLimit({
  maxRequests: 100,
  windowSeconds: 60 * 60,
  keyPrefix: "api:room_templates",
});

export const bookingRateLimit = rateLimit({
  maxRequests: 10,
  windowSeconds: 60,
  keyPrefix: "api:bookings",
});

export const loginRateLimit = rateLimit({
  maxRequests: 5,
  windowSeconds: 6 * 60,
  keyPrefix: "api:login",
});

export const publicGetRateLimit = rateLimit({
  maxRequests: 300,
  windowSeconds: 60,
  keyPrefix: "api:get_public",
});
