import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { ApiError } from "../utils/index.ts";

type ZodSchema = z.ZodType<any>;

export const validate =
  (schema: ZodSchema) => (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = schema.parse({
        body: req.body,
        query: req.query,
        params: req.params,
      });

      if (result.body) req.body = result.body;

      if (result.params) {
        Object.assign(req.params, result.params);
      }

      if (result.query) {
        Object.assign(req.query, result.query);
      }

      next();
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new ApiError(err.message || "Validation failed", 400);
      }
      throw new ApiError("Validation failed", 400);
    }
  };

export const commonValidations = {
  pagination: z.object({
    query: z.object({
      page: z.string().optional(),
      limit: z.string().min(10).max(100),
    }),
  }),
  email: z.object({
    email: z.email(),
  }),
};

export const userValidation = validate(
  z.object({
    body: z.object({
      firstName: z.string().trim().min(1),
      lastName: z.string().trim().min(1),
      email: z.email().trim(),
      avatar: z.url(),
      role: z.string().uppercase().trim(),
    }),
    params: z.object({}).optional(),
    query: z.object({}).optional(),
  }),
);

export const updateUserValidation = validate(
  z.object({
    body: z.object({
      firstName: z.string().trim().min(1),
      lastName: z.string().trim().min(1),
      email: z.email().trim(),
      avatar: z.url(),
    }),
    params: z.object({}).optional(),
    query: z.object({}).optional(),
  }),
)

export const tenantValidation = validate(
  z.object({
    body: z.object({
      name: z.string().min(1).trim(),
      slug: z
        .string()
        .min(1)
        .regex(/^[a-zA-Z0-9-_]+$/, "Slug cannot contain spaces")
        .trim()
        .lowercase(),
      profile: z.url(),
      description: z.string().min(10).trim(),
      currency: z.string().uppercase().min(1).trim(),
      timezone: z.string().min(1).trim(),
    }),
    params: z.object({}).optional(),
    query: z.object({}).optional(),
  }),
);

export const updateTenantValidation = validate(
  z.object({
    body: z.object({
      name: z.string().min(1).trim(),
      profile: z.url(),
      description: z.string().min(10).trim(),
      currency: z.string().uppercase().min(1).trim(),
      timezone: z.string().min(1).trim(),
    }),
    params: z.object({}).optional(),
    query: z.object({}).optional(),
  }),
)

export const propertyValidation = validate(
  z.object({
    body: z.object({
      title: z.string().min(1).trim(),
      type: z.string().min(1).trim(),
      gstin: z.string().uppercase().trim().min(1),
      address: z.string().trim().min(1),
      city: z.string().min(1).trim(),
      state: z.string().min(1).trim(),
      country: z.string().min(1).trim(),
      images: z.array(z.url()),
      postal_code: z.string().min(1).trim(),
      latitude: z.coerce.number().gte(-90).lte(90),
      longitude: z.coerce.number().gte(-180).lte(180),
      contact_email: z.email(),
      contact_phone: z
        .string()
        .min(10)
        .trim()
        .regex(/^\+?[0-9]{10,15}$/),
      starRating: z.number().min(1),
    }),
    query: z.object({}).optional(),
  }),
);

export const updatePropertyValidation = validate(
  z.object({
    body: z.object({
      title: z.string().min(1).trim(),
      type: z.string().min(1).trim(),
      gstin: z.string().uppercase().trim().min(1),
      address: z.string().trim().min(1),
      city: z.string().min(1).trim(),
      state: z.string().min(1).trim(),
      country: z.string().min(1).trim(),
      images: z.array(z.url()),
      postal_code: z.string().min(1).trim(),
      latitude: z.coerce.number().gte(-90).lte(90),
      longitude: z.coerce.number().gte(-180).lte(180),
      contact_email: z.email(),
      contact_phone: z
        .string()
        .min(10)
        .trim()
        .regex(/^\+?[0-9]{10,15}$/),
    }),
    query: z.object({}).optional(),
  }),
)

export const roomTemplateValidation = validate(
  z.object({
    body: z.object({
      title: z.string().min(1).trim(),
      description: z.string().min(1).trim(),
      bedsPerRoom: z.coerce.number().min(1).max(100),
      numberOfRooms: z.coerce.number().min(1).max(250),
      pricePerBed: z.coerce.number().min(1),
      type: z.string().min(1).trim(),
      amenities: z.record(z.string(), z.coerce.boolean()).optional().nullable(),
      image: z.url(),
    }),
    params: z.object({
      propertyId: z.string().min(1),
    }),
    query: z.object({}).optional(),
  }),
);

export const updateRoomTemplateValidation = validate(
  z.object({
    body: z.object({
      title: z.string().min(1).trim(),
      description: z.string().min(1).trim(),
      pricePerBed: z.coerce.number().min(1),
      type: z.string().min(1).trim(),
      amenities: z.record(z.string(), z.coerce.boolean()).optional().nullable(),
      image: z.url(),
    }),
    params: z.object({
      propertyId: z.string().min(1),
    }),
    query: z.object({}).optional(),
  }),
)

export const bookingValidation = validate(
  z.object({
    body: z.object({
      roomTemplateId: z.string().min(1).trim(),
      // roomId: z.string().min(1).trim(),
      startDate: z.coerce.date(),
      endDate: z.coerce.date(),
      // bedId: z.string().min(1).trim(),
    }),
    params: z.object({
      propertyId: z.string().min(1).trim(),
    }),
    query: z.object({}).optional(),
  }),
);


