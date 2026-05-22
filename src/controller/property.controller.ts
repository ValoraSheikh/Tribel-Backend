import prisma from "../lib/prisma/db.ts";
import { ApiError, ApiResponse, asyncHandler } from "../lib/index.ts";
import { getSecuredClient } from "../lib/prisma/prisma-rls.ts";
import client from "../lib/redis/redis-cache.ts";

export const createProperty = asyncHandler(async (req, res) => {
  const {
    title,
    type,
    gstin,
    address,
    city,
    state,
    country,
    images,
    postal_code,
    description,
    latitude,
    longitude,
    contact_email,
    contact_phone,
    amenities,
    starRating = 0,
  } = req.body;

  if (!req.user?.id) {
    throw new ApiError("User ID is missing", 401);
  }

  const secureDB = getSecuredClient({
    userId: req.user.id,
    tenantId: "",
    role: "",
    auth0Id: req.oidc.user?.sub,
  });

  const user = await secureDB.user.findUnique({
    where: {
      id: req.user.id,
    },
    select: {
      id: true,
      tenant: true,
      role: true,
    },
  });

  const tenant = user?.tenant;

  if (!tenant) {
    throw new ApiError("Tenant not found", 404);
  }

  const withRLS = getSecuredClient({
    userId: req.user.id,
    tenantId: tenant.id,
    role: user.role,
    auth0Id: req.oidc.user?.sub,
  });

  const property = await withRLS.property.create({
    data: {
      tenantId: tenant.id,
      adminId: req.user.id,
      title: title,
      type: type,
      gstin: gstin,
      address: address,
      city: city,
      images: images,
      state: state,
      country: country,
      postal_code: postal_code,
      latitude: latitude,
      longitude: longitude,
      contact_email: contact_email,
      contact_phone: contact_phone,
      starRating: starRating,
      description: description,
      amenities: amenities,
    },
    select: {
      id: true,
      adminId: true,
      title: true,
      type: true,
      address: true,
      gstin: true,
      city: true,
      state: true,
      country: true,
      postal_code: true,
      contact_email: true,
      contact_phone: true,
      starRating: true,
      latitude: true,
      longitude: true,
      updatedAt: true,
      createdAt: true,
      description: true,
      images: true,
      amenities: true,
      tenant: {
        select: {
          id: true,
          name: true,
          slug: true,
          userId: true,
          description: true,
          profile: true,
          currency: true,
          timezone: true,
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              avatar: true,
            },
          },
        },
      },
    },
  });

  await client.set(
    `property:${property.id}`,
    JSON.stringify(property),
    "EX",
    3600,
  );

  return res
    .status(201)
    .json(new ApiResponse(property, "Property Created Successfully", 201));
});

export const updateProperty = asyncHandler(async (req, res) => {
  const {
    title,
    type,
    gstin,
    address,
    description,
    amenities,
    city,
    state,
    country,
    images,
    postal_code,
    latitude,
    longitude,
    contact_email,
    contact_phone,
  } = req.body;

  const { propertyId } = req.params;

  if (!propertyId) {
    throw new ApiError("Tenant and Property ID is required", 400);
  }

  if (!req.user?.id) {
    throw new ApiError("User ID is missing", 401);
  }

  const [user, propertyOwner] = await Promise.all([
    prisma.user.findUnique({
      where: {
        id: req.user.id,
      },
      include: {
        tenant: true,
      },
    }),

    prisma.property.findUnique({
      where: {
        id: propertyId,
      },
    }),
  ]);

  if (!user) throw new ApiError("User not found", 404);

  const tenant = user.tenant;

  if (!tenant) {
    throw new ApiError("Tenant not found", 404);
  }

  if (propertyOwner?.tenantId !== tenant.id) {
    throw new ApiError("Forbidden", 403);
  }

  if (!propertyOwner?.tenantId) {
    throw new ApiError("Forbidden", 403);
  }

  const securedDB = getSecuredClient({
    userId: req.user.id,
    tenantId: tenant?.id,
    role: user.role,
    auth0Id: user.auth0Id,
  });

  const property = await securedDB.property.update({
    where: {
      id: propertyId,
    },
    data: {
      title: title,
      type: type,
      gstin: gstin,
      address: address,
      city: city,
      state: state,
      country: country,
      images: images,
      postal_code: postal_code,
      latitude: latitude,
      longitude: longitude,
      contact_email: contact_email,
      contact_phone: contact_phone,
      description: description,
      amenities: amenities,
    },
    select: {
      id: true,
      adminId: true,
      title: true,
      type: true,
      address: true,
      gstin: true,
      city: true,
      state: true,
      country: true,
      postal_code: true,
      contact_email: true,
      contact_phone: true,
      starRating: true,
      latitude: true,
      longitude: true,
      updatedAt: true,
      createdAt: true,
      description: true,
      images: true,
      amenities: true,
      tenant: {
        select: {
          id: true,
          name: true,
          slug: true,
          userId: true,
          description: true,
          profile: true,
          currency: true,
          timezone: true,
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              avatar: true,
            },
          },
        },
      },
    },
  });

  if (!property) {
    throw new ApiError("Property not found", 404);
  }

  await client.set(
    `property:${propertyId}`,
    JSON.stringify(property),
    "EX",
    3600,
  );

  return res
    .status(200)
    .json(new ApiResponse(property, "Property Updated Successfully", 200));
});

export const deleteProperty = asyncHandler(async (req, res) => {
  const { propertyId } = req.params;

  if (!propertyId) {
    throw new ApiError("Tenant and Property ID is required", 400);
  }

  if (!req.user?.id) {
    throw new ApiError("User ID is missing", 401);
  }

  const [user, propertyOwner] = await Promise.all([
    prisma.user.findUnique({
      where: {
        id: req.user.id,
      },
      include: {
        tenant: true,
      },
    }),

    prisma.property.findUnique({
      where: {
        id: propertyId,
      },
    }),
  ]);

  if (!user) throw new ApiError("User not found", 404);

  const tenant = user.tenant;

  if (!tenant) {
    throw new ApiError("Tenant not found", 404);
  }

  if (propertyOwner?.tenantId !== tenant.id) {
    throw new ApiError("Forbidden", 403);
  }

  const securedDB = getSecuredClient({
    userId: req.user.id,
    tenantId: tenant?.id,
    role: user.role,
    auth0Id: user.auth0Id,
  });

  const deleteProperty = await securedDB.property.delete({
    where: {
      id: propertyId,
    },
  });

  if (!deleteProperty) {
    throw new ApiError("Property not found", 404);
  }

  await client.del(`property:${propertyId}`);

  return res
    .status(200)
    .json(
      new ApiResponse(deleteProperty, "Property deleted Successfully", 200),
    );
});

export const getAdminProperties = asyncHandler(async (req, res) => {
  let page = parseInt(req.query.page as string) || 1;
  let limit = parseInt(req.query.limit as string) || 10;
  let skip = (page - 1) * limit;
  limit = Math.min(Math.max(limit, 1), 50);

  if (!req.user?.id) {
    throw new ApiError("User ID is missing", 401);
  }

  const secureDB = getSecuredClient({
    userId: req.user.id,
    role: "",
    tenantId: "",
    auth0Id: req.oidc.user?.sub,
  });

  const user = await secureDB.user.findUnique({
    where: {
      id: req.user.id,
    },
    include: {
      tenant: true,
    },
  });

  if (!user) throw new ApiError("User not found", 404);

  const tenant = user.tenant;

  if (!tenant) {
    throw new ApiError("Tenant not found", 404);
  }

  const securedDB = getSecuredClient({
    userId: user.id,
    tenantId: tenant?.id,
    role: user.role,
    auth0Id: user.auth0Id,
  });

  const [properties, totalProperties] = await Promise.all([
    securedDB.property.findMany({
      where: {
        tenantId: tenant.id,
      },
      select: {
        id: true,
        adminId: true,
        title: true,
        type: true,
        address: true,
        gstin: true,
        city: true,
        state: true,
        country: true,
        postal_code: true,
        contact_email: true,
        contact_phone: true,
        starRating: true,
        images: true,
        latitude: true,
        longitude: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
        amenities: true,
      },
      take: limit,
      skip: skip,
      orderBy: {
        createdAt: "desc",
      },
    }),

    securedDB.property.count({
      where: {
        tenantId: tenant?.id,
      },
    }),
  ]);

  if (!properties) {
    return res.status(404).json(new ApiResponse([], "No Property found", 404));
  }

  return res.status(200).json(
    new ApiResponse(
      {
        properties: properties,
        page,
        totalProperty: totalProperties,
        totalPages: Math.ceil(totalProperties / limit),
      },
      "Fetched all properties Successfully",
      200,
    ),
  );
});

export const getPropertyDetail = asyncHandler(async (req, res) => {
  const { propertyId } = req.params;

  if (!propertyId) {
    throw new ApiError("Property ID is required", 400);
  }

  const propertyCache = await client.get(`property:${propertyId}`);

  if (propertyCache) {
    const parsedData = JSON.parse(propertyCache);

    return res.json(
      new ApiResponse(parsedData, "Property fetched Successfully", 200),
    );
  }

  const propertyDetail = await prisma.property.findUnique({
    where: {
      id: propertyId,
    },
    select: {
      id: true,
      adminId: true,
      title: true,
      type: true,
      address: true,
      gstin: true,
      city: true,
      state: true,
      country: true,
      postal_code: true,
      contact_email: true,
      contact_phone: true,
      starRating: true,
      latitude: true,
      longitude: true,
      updatedAt: true,
      createdAt: true,
      description: true,
      images: true,
      amenities: true,
      tenant: {
        select: {
          id: true,
          name: true,
          slug: true,
          userId: true,
          description: true,
          profile: true,
          currency: true,
          timezone: true,
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              avatar: true,
            },
          },
        },
      },
    },
  });

  if (!propertyDetail) {
    throw new ApiError("No property found with this ID", 404);
  }

  await client.set(
    `property:${propertyId}`,
    JSON.stringify(propertyDetail),
    "EX",
    3600,
  );

  return res
    .status(200)
    .json(
      new ApiResponse(propertyDetail, "Property fetched Successfully", 200),
    );
});

export const searchProperty = asyncHandler(async (req, res) => {
  let { property } = req.query;
  let page = parseInt(req.query.page as string) || 1;
  let limit = parseInt(req.query.limit as string) || 10;
  let skip = (page - 1) * limit;
  limit = Math.min(Math.max(limit, 1), 50);

  if (!property || typeof property !== "string" || !property.trim()) {
    throw new ApiError("Input required to search properties", 400);
  }

  let words = property.trim().split(/\s+/);

  const [properties, totalProperties] = await prisma.$transaction([
    prisma.property.findMany({
      where: {
        AND: words.map((word) => ({
          OR: [
            {
              title: {
                contains: word,
                mode: "insensitive",
              },
            },
            {
              city: {
                contains: word,
                mode: "insensitive",
              },
            },
          ],
        })),
      },
      select: {
        id: true,
        title: true,
        type: true,
        address: true,
        gstin: true,
        city: true,
        state: true,
        country: true,
        postal_code: true,
        contact_email: true,
        contact_phone: true,
        starRating: true,
        images: true,
        latitude: true,
        longitude: true,
      },
      take: limit,
      skip: skip,
      orderBy: {
        starRating: "desc",
      },
    }),

    prisma.property.count({
      where: {
        AND: words.map((word) => ({
          OR: [
            {
              title: {
                contains: word,
                mode: "insensitive",
              },
            },
            {
              city: {
                contains: word,
                mode: "insensitive",
              },
            },
            {
              state: {
                contains: word,
                mode: "insensitive",
              },
            },
          ],
        })),
      },
    }),
  ]);

  if (!properties.length) {
    throw new ApiError("No properties match your search criteria", 404);
  }

  return res.status(200).json(
    new ApiResponse(
      {
        properties: properties,
        page,
        totalProperty: totalProperties,
        totalPages: Math.ceil(totalProperties / limit),
      },
      "Properties found Successfully",
      200,
    ),
  );
});

export const findPropertyOnLocation = asyncHandler(async (req, res) => {
  const { latitude, longitude, city } = req.body;
  let page = parseInt(req.query.page as string) || 1;
  let limit = parseInt(req.query.limit as string) || 10;
  let skip = (page - 1) * limit;
  limit = Math.min(Math.max(limit, 1), 50);

  const properties = await prisma.property.findMany({
    where: {
      city: city,
    },
    select: {
      title: true,
      type: true,
      address: true,
      gstin: true,
      city: true,
      state: true,
      country: true,
      postal_code: true,
      contact_email: true,
      contact_phone: true,
      starRating: true,
      images: true,
      latitude: true,
      longitude: true,
    },
    take: limit,
    skip: skip,
  });

  const totalProperties = await prisma.property.count({
    where: {
      city: city,
    },
  });

  if (!properties.length) {
    throw new ApiError("No properties found here", 404);
  }

  return res.status(200).json(
    new ApiResponse(
      {
        properties: properties,
        page,
        totalProperties: totalProperties,
        totalPages: Math.ceil(totalProperties / limit),
      },
      "Properties found Successfully",
      200,
    ),
  );
});

export const newProperties = asyncHandler(async (req, res) => {
  let limit = parseInt(req.query.limit as string) || 8;
  limit = Math.min(Math.max(limit, 1), 50);

  const properties = await prisma.property.findMany({
    select: {
      id: true,
      title: true,
      type: true,
      address: true,
      gstin: true,
      city: true,
      state: true,
      country: true,
      postal_code: true,
      contact_email: true,
      contact_phone: true,
      starRating: true,
      images: true,
      latitude: true,
      longitude: true,
    },
    take: limit,
    orderBy: { createdAt: "desc" },
  });

  if (!properties.length) {
    throw new ApiError("No properties found here", 404);
  }

  return res
    .status(200)
    .json(new ApiResponse(properties, "Properties fetched Successfully", 200));
});
