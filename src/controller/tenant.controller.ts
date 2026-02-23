import prisma from "../lib/prisma/db.ts";
import { ApiError, ApiResponse, asyncHandler } from "../lib/index.ts";
import { getSecuredClient } from "../lib/prisma/prisma-rls.ts";

export const createTenant = asyncHandler(async (req, res) => {
  const { name, slug, description, profile, currency, timezone } = req.body;

  if (!req.user?.id) {
    throw new ApiError("User ID is missing", 401);
  }
  
  const securedDB = getSecuredClient({
    userId: req.user.id,
    tenantId: "",
    role: "",
    auth0Id: req.oidc.user?.sub
  })


  const user = await securedDB.user.findUnique({
    where: {
      id: req.user.id,
    },
    select: {
      tenant: true,
    }
  });

  if (!user || user.tenant != null) {
    throw new ApiError("User already have tenant", 401);
  }

  await securedDB.user.update({
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
  
  const securedDB = getSecuredClient({
    userId: req.user.id,
    tenantId: "",
    role: "",
    auth0Id: req.oidc.user?.sub
  })


  const user = await securedDB.user.findUnique({
    where: {
      id: req.user.id,
    },
    include: {
      tenant: true
    }
  });

  if (!user) {
    throw new ApiError("User not found", 404);
  }
  
  const tenantId = user.tenant?.id || "";
  
  const securedDB1 = getSecuredClient({
    userId: req.user.id,
    tenantId: tenantId,
    role: user.role,
    auth0Id: req.oidc.user?.sub
  })

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
    auth0Id: req.oidc.user?.sub
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
  const { name, description, profile, currency, timezone } = req.body;

  if (!req.user?.id) {
    throw new ApiError("User ID missing", 401);
  }

  const tenant = await prisma.tenant.findFirst({
    where: { userId: req.user.id },
  });

  if (!tenant) {
    throw new ApiError("Tenant not found", 404);
  }

  const securedDB = getSecuredClient({
    userId: req.user.id,
    tenantId: tenant.id,
    role: req.user.role,
    auth0Id: req.oidc.user?.sub
  });

  const data = await securedDB.tenant.update({
    where: { userId: req.user.id },
    data: {
      name: name,
      description: description,
      profile: profile,
      currency: currency,
      timezone: timezone,
    },
  });

  return res
    .status(200)
    .json(new ApiResponse(data, "Tenant updated successfully", 200));
});
