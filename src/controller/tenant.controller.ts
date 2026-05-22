import prisma from "../lib/prisma/db.ts";
import { ApiError, ApiResponse, asyncHandler } from "../lib/index.ts";
import { getSecuredClient } from "../lib/prisma/prisma-rls.ts";
import client from "../lib/redis/redis-cache.ts";
import { deleteObject } from "../services/s3.service.ts";

export const createTenant = asyncHandler(async (req, res) => {
  const { name, slug, description, profile, currency, timezone } = req.body;

  if (!req.user?.id) {
    throw new ApiError("User ID is missing", 401);
  }

  if (req.user.role == "Admin") {
    throw new ApiError("User already has a tenant", 401);
  }

  const securedDB = getSecuredClient({
    userId: req.user.id,
    tenantId: "",
    role: "",
    auth0Id: req.oidc.user?.sub,
  });

  const user = await securedDB.user.update({
    where: {
      id: req.user.id,
    },
    data: {
      role: "Admin",
    },
    select: {
      firstName: true,
      lastName: true,
      email: true,
      avatar: true,
      role: true,
      auth0Id: true,
      tenant: true,
      createdAt: true,
      updatedAt: true,
      id: true,
      phoneNo: true,
    },
  });

  if (!user) {
    throw new ApiError("User not found", 404);
  }

  if (user.tenant != null) {
    throw new ApiError("User already has a tenant", 401);
  }

  req.user = {
    id: user.id,
    role: user.role,
    email: user.email,
    name: user.firstName,
  };

  await client.set(
    `session:${user.auth0Id}`,
    JSON.stringify(req.user),
    "EX",
    3600,
  );

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

  const userData = await securedDB.user.findUnique({
    where: {
      id: req.user.id,
    },
    select: {
      firstName: true,
      lastName: true,
      email: true,
      avatar: true,
      role: true,
      auth0Id: true,
      tenant: true,
      createdAt: true,
      updatedAt: true,
      id: true,
      phoneNo: true,
    },
  });

  await client.set(
    `user:${user.auth0Id}`,
    JSON.stringify(userData),
    "EX",
    3600,
  );

  await client.set(`tenant:${tenant.id}`, JSON.stringify(tenant), "EX", 3600);

  return res
    .status(201)
    .json(new ApiResponse(tenant, "Tenant created successfully", 201));
});

export const getTenantDetail = asyncHandler(async (req, res) => {
  if (!req.user.id) {
    throw new ApiError("User ID is required", 400);
  }

  const userCache = await client.get(`user:${req.oidc.user?.sub}`);

  if (userCache) {
    const userData = JSON.parse(userCache);
    const tenantId = userData?.tenant.id;
    const tenantCache = await client.get(`tenant:${tenantId}`);
    if (tenantCache) {
      return res
        .status(200)
        .json(
          new ApiResponse(
            JSON.parse(tenantCache),
            "Tenant Fetched successfully",
            200,
          ),
        );
    }
  }

  const securedDB = getSecuredClient({
    userId: req.user.id,
    tenantId: "",
    role: "",
    auth0Id: req.oidc.user?.sub,
  });

  const user = await securedDB.user.findUnique({
    where: {
      id: req.user.id,
    },
    include: {
      tenant: true,
    },
  });

  if (!user) {
    throw new ApiError("User not found", 404);
  }

  const tenantId = user.tenant?.id || "";

  const tenantCache = await client.get(`tenant:${tenantId}`);
  if (tenantCache) {
    return res
      .status(200)
      .json(
        new ApiResponse(
          JSON.parse(tenantCache),
          "Tenant Fetched successfully",
          200,
        ),
      );
  }

  const securedDB1 = getSecuredClient({
    userId: req.user.id,
    tenantId: tenantId,
    role: user.role,
    auth0Id: req.oidc.user?.sub,
  });

  const tenantDetail = await securedDB1.tenant.findUnique({
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

  await client.set(
    `tenant:${tenantDetail.id}`,
    JSON.stringify(tenantDetail),
    "EX",
    3600,
  );

  return res
    .status(200)
    .json(new ApiResponse(tenantDetail, "Tenant Fetched successfully", 200));
});

export const getAllTenants = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page as string) || 1;
  let limit = parseInt(req.query.limit as string) || 10;
  limit = Math.min(Math.max(limit, 1), 50);
  const skip = (page - 1) * limit;

  if (!req.user?.id) {
    throw new ApiError("User ID missing", 401);
  }

  const user = await prisma.user.findFirst({
    where: {
      id: req.user.id,
    },
  });

  if (!user) throw new ApiError("User not found", 404);

  if (user.role !== "Super_Admin")
    throw new ApiError("You are not allowed", 403);

  const securedDB = getSecuredClient({
    userId: user.id,
    tenantId: "",
    role: user.role,
    auth0Id: req.oidc.user?.sub,
  });

  const [tenants, totalTenants] = await Promise.all([
    securedDB.tenant.findMany({
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
    }),
    securedDB.tenant.count(),
  ]);

  if (!tenants.length) {
    throw new ApiError("No tenants found", 404);
  }

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
  const { name, description, currency, timezone } = req.body;

  if (!req.user?.id) {
    throw new ApiError("User ID missing", 401);
  }

  const tenant = await prisma.tenant.findUnique({
    where: { userId: req.user.id },
  });

  if (!tenant) {
    throw new ApiError("Tenant not found", 404);
  }

  const securedDB = getSecuredClient({
    userId: req.user.id,
    tenantId: tenant.id,
    role: req.user.role,
    auth0Id: req.oidc.user?.sub,
  });

  const data = await securedDB.tenant.update({
    where: { userId: req.user.id },
    data: {
      name: name,
      description: description,
      currency: currency,
      timezone: timezone,
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

  await client.set(`tenant:${tenant.id}`, JSON.stringify(data), "EX", 3600);

  return res
    .status(200)
    .json(new ApiResponse(data, "Tenant updated successfully", 200));
});

export const updateTenantProfile = asyncHandler(async (req, res) => {
  const { key } = req.body;

  if (!req.user?.id) {
    throw new ApiError("User ID missing", 401);
  }

  const tenant = await prisma.tenant.findUnique({
    where: { userId: req.user.id },
    select: {
      id: true,
      profile: true,
    },
  });

  if (!tenant) {
    throw new ApiError("Tenant not found", 404);
  }

  const oldKey = tenant.profile;

  const securedDB = getSecuredClient({
    userId: req.user.id,
    tenantId: tenant.id,
    role: req.user.role,
    auth0Id: req.oidc.user?.sub,
  });

  await securedDB.tenant.update({
    where: {
      id: tenant.id,
    },
    data: {
      profile: key,
    },
  });

  await client.del(`tenant:${tenant.id}`);

  if (oldKey?.startsWith("public/")) {
    await deleteObject({ key: oldKey });
  }

  res
    .status(200)
    .json(new ApiResponse({}, "Profile updated successfully", 200));
});
