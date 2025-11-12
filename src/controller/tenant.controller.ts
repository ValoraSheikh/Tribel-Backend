import type { Request, Response } from "express";
import prisma from "../utils/db.ts";
import { ApiError, ApiResponse, asyncHandler } from "../utils/index.ts";

export const createTenant = asyncHandler(async (req, res) => {
  const { name, slug, description, profile, currency, timezone } = req.body;

  if (!req.user?.id) {
    throw new ApiError("User ID is missing", 401);
  }

  const tenant = await prisma.tenant.create({
    data: {
      name: name,
      slug: slug,
      userId: req.user.id,
      description: description,
      profile: profile,
      currency: currency,
      timezone: timezone,
    },
  });

  return res
    .status(201)
    .json(new ApiResponse(tenant, "Tenant created successfully", 201));
});

export const getTenantDetail = asyncHandler(async (req, res) => {
  const { tenantId } = req.params;

  if (!tenantId) {
    throw new ApiError("Tenant ID is required", 400);
  }

  const tenant = await prisma.tenant.findUnique({
    where: {
      id: tenantId,
    },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      profile: true,
      timezone: true,
      createdAt: true,
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          role: true,
        },
      },
    },
  });

  if (!tenant) {
    throw new ApiError("No tenant found with this ID", 404);
  }

  return res
    .status(200)
    .json(new ApiResponse(tenant, "Tenant Fetched successfully", 200));
});

export const getAllTenants = asyncHandler(async (_req, res) => {
  const tenant = await prisma.tenant.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      profile: true,
      timezone: true,
      createdAt: true,
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          role: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return res
    .status(200)
    .json(new ApiResponse(tenant, "Fetched all tenants successfully", 200));
});

export const updateTenant = asyncHandler(async (req, res) => {
  const { tenantId } = req.params;
  const { name, description, profile } = req.body;

  if (!tenantId) {
    throw new ApiError("Tenant ID is required", 400);
  }

  if (!req.user?.id) {
    throw new ApiError("User ID missing", 401);
  }

  const tenantAdmin = await prisma.tenant.findUnique({
    where: {
      id: tenantId,
    },
  });

  if (req.user.id !== tenantAdmin?.userId) {
    throw new ApiError("Forbidden", 403);
  }

  const tenant = await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      name: name,
      description: description,
      profile: profile,
    },
  });

  if (!tenant) {
    throw new ApiError("Tenant not found", 404);
  }

  return res
    .status(200)
    .json(new ApiResponse(tenant, "Tenant updated successfully", 200));
});
