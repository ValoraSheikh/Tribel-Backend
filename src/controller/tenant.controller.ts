import prisma from "../utils/db.ts";
import { ApiError, ApiResponse, asyncHandler } from "../utils/index.ts";

export const createTenant = asyncHandler(async (req, res) => {
  const { name, slug, description, profile, currency, timezone } = req.body;

  if (!req.user?.id) {
    throw new ApiError("User ID is missing", 401);
  }

  const user = await prisma.user.findUnique({
    where: {
      id: req.user.id,
    },
    select: {
      tenant: true,
    },
  });

  if (!user || user.tenant != null) {
    throw new ApiError("User already have tenant", 401);
  }

  await prisma.user.update({
    where: {
      id: req.user.id,
    },
    data: {
      role: "Admin",
    },
  });

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
  if (!req.user.id) {
    throw new ApiError("User ID is required", 400);
  }

  const user = await prisma.user.findUnique({
    where: {
      id: req.user.id,
    },
  });

  if (!user) {
    throw new ApiError("User not found", 404);
  }

  const tenantDetail = await prisma.tenant.findUnique({
    where: {
      userId: user.id,
    },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      profile: true,
      timezone: true,
      createdAt: true,
      updatedAt: true,
      currency: true,
      userId: true,
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          role: true,
          auth0Id: true,
          avatar: true,
          email: true,
          phoneNo: true,
        },
      },
    },
  });

  if (!tenantDetail) {
    throw new ApiError("No tenant found with this ID", 404);
  }

  return res
    .status(200)
    .json(new ApiResponse(tenantDetail, "Tenant Fetched successfully", 200));
});

export const getAllTenants = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page as string) || 1;
  let limit = parseInt(req.query.limit as string) || 10;
  limit = Math.min(Math.max(limit, 1), 50);
  const skip = (page - 1) * limit;

  const tenants = await prisma.tenant.findMany({
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
    take: limit,
    skip: skip,
    orderBy: {
      createdAt: "desc",
    },
  });

  if (!tenants.length) {
    throw new ApiError("No tenants found", 404);
  }

  const totalTenants = await prisma.tenant.count();

  return res.status(200).json(
    new ApiResponse(
      {
        tenants: tenants,
        page,
        totalTenants: totalTenants,
        totalPages: Math.ceil(totalTenants / limit),
      },
      "Fetched all tenants successfully",
      200,
    ),
  );
});

export const updateTenant = asyncHandler(async (req, res) => {
  const { name, description, profile, currency, timezone } = req.body;

  if (!req.user?.id) {
    throw new ApiError("User ID missing", 401);
  }

  const tenant = await prisma.tenant.update({
    where: { userId: req.user.id },
    data: {
      name: name,
      description: description,
      profile: profile,
      currency: currency,
      timezone: timezone,
    },
  });

  if (!tenant) {
    throw new ApiError("Tenant not found", 404);
  }

  return res
    .status(200)
    .json(new ApiResponse(tenant, "Tenant updated successfully", 200));
});
