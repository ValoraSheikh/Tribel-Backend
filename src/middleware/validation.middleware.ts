import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { ApiError } from "../lib/index.ts";

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
      avatar: z.string().trim().min(1),
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
      phoneNo: z.string().trim().min(10).max(10),
      // email: z.email().trim(),
      // avatar: z.url(),
    }),
    params: z.object({}).optional(),
    query: z.object({}).optional(),
  }),
);

export const tenantValidation = validate(
  z.object({
    body: z.object({
      name: z.string().min(1).trim(),
      slug: z
        .string()
        .min(1)
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug cannot contain spaces")
        .trim()
        .lowercase(),
      profile: z.string(),
      description: z.string().min(10).trim(),
      currency: z.string().min(1).trim(),
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
      description: z.string().min(10).trim(),
      currency: z.string().uppercase().min(1).trim(),
      timezone: z.string().min(1).trim(),
    }),
    params: z.object({}).optional(),
    query: z.object({}).optional(),
  }),
);

export const propertyValidation = validate(
  z.object({
    body: z.object({
      title: z.string().min(1).trim(),
      type: z.string().min(1).trim(),
      gstin: z.string().uppercase().trim().min(1),
      address: z.string().trim().min(1),
      description: z.string().trim().min(1),
      city: z.string().min(1).trim(),
      state: z.string().min(1).trim(),
      country: z.string().min(1).trim(),
      images: z.array(z.string()),
      postal_code: z.string().min(1).trim(),
      latitude: z.coerce.number().gte(-90).lte(90),
      longitude: z.coerce.number().gte(-180).lte(180),
      amenities: z.array(
        z.object({
          name: z.string().min(1).trim(),
          icon: z.string().min(1).trim(),
        }),
      ),
      contact_email: z.email(),
      contact_phone: z
        .string()
        .min(10)
        .trim()
        .regex(/^\+?[0-9]{10,15}$/),
      // starRating: z.number().min(1),
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
      amenities: z
        .array(
          z.object({
            name: z.string().min(1).trim(),
            icon: z.string().min(1).trim(),
          }),
        )
        .optional(),
      description: z.string().trim().min(1),
      city: z.string().min(1).trim(),
      state: z.string().min(1).trim(),
      country: z.string().min(1).trim(),
      images: z.array(z.string()),
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
);

export const roomTemplateValidation = validate(
  z.object({
    body: z.object({
      title: z.string().min(1).trim(),
      description: z.string().min(1).trim(),
      bedsPerRoom: z.coerce.number().min(1).max(100),
      numberOfRooms: z.coerce.number().min(1).max(250),
      pricePerBed: z.coerce.number().min(1),
      type: z.string().min(1).trim(),
      amenities: z
        .array(
          z.object({
            name: z.string().min(1).trim(),
            icon: z.string().min(1).trim(),
          }),
        )
        .optional(),
      image: z.string().min(1).trim(),
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
      amenities: z
        .array(
          z.object({
            name: z.string().min(1).trim(),
            icon: z.string().min(1).trim(),
          }),
        )
        .optional(),
      image: z.string().min(1).trim(),
    }),
    params: z.object({
      propertyId: z.string().min(1),
    }),
    query: z.object({}).optional(),
  }),
);

export const bookingValidation = validate(
  z.object({
    body: z.object({
      roomTemplateId: z.string().min(1).trim(),
      propertyId: z.string().min(1).trim(),
      // roomId: z.string().min(1).trim(),
      startDate: z.coerce.date(),
      endDate: z.coerce.date(),
      // bedId: z.string().min(1).trim(),
      paymentMode: z.enum(["OFFLINE", "ONLINE",]),
      phoneNo: z.string().min(10).max(10).trim(),
    }),
    params: z.object({}).optional(),
    query: z.object({}).optional(),
  }),
);

export const occupancyValidation = validate(
  z.object({
    body: z.object({}).optional(),
    params: z.object({
      propertyId: z.string().min(1),
    }),
    query: z.object({
      startDate: z.coerce.date().optional(),
      endDate: z.coerce.date().optional(),
    }),
  }),
);

export const bookingStatusValidation = validate(
  z.object({
    body: z.object({
      bookingId: z.string().uuid(),
      action: z.enum(["APPROVE", "REJECT"]),
    }),
    params: z.object({
      propertyId: z.string().min(1),
    }),
    query: z.object({}).optional(),
  }),
);

export const markPaidValidation = validate(
  z.object({
    body: z.object({
      bookingId: z.string().uuid(),
      provider: z.enum(["CASH", "UPI", "BANK_TRANSFER"]).optional(),
      reference: z.string().max(255).optional(),
    }),
    params: z.object({
      propertyId: z.string().min(1),
    }),
    query: z.object({}).optional(),
  }),
);

export const assignBedValidation = validate(
  z.object({
    body: z.object({
      bookingId: z.string().uuid(),
      bedId: z.string().uuid(),
    }),
    params: z.object({
      propertyId: z.string().min(1),
    }),
    query: z.object({}).optional(),
  }),
);

export const updateDatesValidation = validate(
  z.object({
    body: z.object({
      bookingId: z.string().uuid(),
      startDate: z.coerce.date(),
      endDate: z.coerce.date(),
    }),
    params: z.object({
      propertyId: z.string().min(1).optional(),
    }),
    query: z.object({}).optional(),
  }),
);

export const refundValidation = validate(
  z.object({
    body: z.object({
      bookingId: z.string().uuid(),
      amount: z.number().positive().optional(),
      method: z
        .enum(["CASH", "UPI", "BANK_TRANSFER", "RAZORPAY"])
        .optional(),
      reference: z.string().max(255).optional(),
      razorpayRefundId: z.string().max(64).optional(),
    }),
    params: z.object({
      propertyId: z.string().min(1),
    }),
    query: z.object({}).optional(),
  }),
);

export const createOrderValidation = validate(
  z.object({
    body: z.object({
      bookingId: z.string().uuid(),
    }),
    query: z.object({}).optional(),
  }),
);

export const verifyPaymentValidation = validate(
  z.object({
    body: z.object({
      razorpay_order_id: z.string().min(1),
      razorpay_payment_id: z.string().min(1),
      razorpay_signature: z.string().min(1),
      bookingId: z.string().uuid(),
    }),
    query: z.object({}).optional(),
  }),
);

export const uploadValidaton = validate(
  z.object({
    body: z.object({
      entity: z.string().trim().min(1),
      fileType: z.string().trim().min(1),
      entityId: z.string().trim().min(1),
    }),
  }),
);
