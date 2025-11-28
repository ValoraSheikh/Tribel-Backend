import prisma from "../utils/db.ts";
import { ApiError, ApiResponse, asyncHandler } from "../utils/index.ts";

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
    latitude,
    longitude,
    contact_email,
    contact_phone,
    starRating,
  } = req.body;

  if (!req.user?.id) {
    throw new ApiError("User ID is missing", 401);
  }

  const tenant = await prisma.tenant.findUnique({
    where: {
      userId: req.user?.id,
    },
  });

  if (!tenant) {
    throw new ApiError("Tenant not found", 404);
  }

  const property = await prisma.property.create({
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
    },
  });

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

  const tenant = await prisma.tenant.findUnique({
    where: {
      userId: req.user?.id,
    },
  });

  if (!tenant) {
    throw new ApiError("Tenant not found", 404);
  }

  const propertyOwner = await prisma.property.findUnique({
    where: {
      id: propertyId,
    },
  });

  if (propertyOwner?.tenantId !== tenant.id) {
    throw new ApiError("Forbidden", 403);
  }

  const property = await prisma.property.update({
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
    },
  });

  if (!property) {
    throw new ApiError("Property not found", 404);
  }

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

  const tenant = await prisma.tenant.findUnique({
    where: {
      userId: req.user?.id,
    },
  });

  if (!tenant) {
    throw new ApiError("Tenant not found", 404);
  }

  const propertyOwner = await prisma.property.findUnique({
    where: {
      id: propertyId,
    },
  });

  if (propertyOwner?.tenantId !== tenant.id) {
    throw new ApiError("Forbidden", 403);
  }

  const deleteProperty = await prisma.property.delete({
    where: {
      id: propertyId,
    },
  });

  if (!deleteProperty) {
    throw new ApiError("Property not found", 404);
  }

  return res
    .status(200)
    .json(
      new ApiResponse(deleteProperty, "Property deleted Successfully", 200),
    );
});

export const getAllPropertiesForAdmin = asyncHandler(async (req, res) => {
  let page = parseInt(req.query.page as string) || 1;
  let limit = parseInt(req.query.limit as string) || 10;
  let skip = (page - 1) * limit;
  limit = Math.min(Math.max(limit, 1), 50);

  if (!req.user?.id) {
    throw new ApiError("User ID is missing", 401);
  }

  const tenant = await prisma.tenant.findUnique({
    where: {
      userId: req.user?.id,
    },
  });

  if (!tenant) {
    throw new ApiError("Tenant not found", 404);
  }

  const properties = await prisma.property.findMany({
    where: {
      tenantId: tenant?.id,
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
    orderBy: {
      createdAt: "desc",
    },
  });

  if (!properties.length) {
    throw new ApiError("No property found", 404);
  }

  const totalProperties = await prisma.property.count({
    where: {
      tenantId: tenant?.id,
    },
  });

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

  const propertyDetail = await prisma.property.findUnique({
    where: {
      id: propertyId,
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
      latitude: true,
      longitude: true,
      tenant: {
        select: {
          name: true,
          slug: true,
          userId: true,
          description: true,
          profile: true,
          currency: true,
          timezone: true,
          user: {
            select: {
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

  return res
    .status(200)
    .json(
      new ApiResponse(propertyDetail, "Property fetched Successfully", 200),
    );
});

export const searchProperty = asyncHandler(async (req, res) => {
  let { propertyName } = req.query;
  let page = parseInt(req.query.page as string) || 1;
  let limit = parseInt(req.query.limit as string) || 10;
  let skip = (page - 1) * limit;
  limit = Math.min(Math.max(limit, 1), 50);

  if (
    !propertyName ||
    typeof propertyName !== "string" ||
    !propertyName.trim()
  ) {
    throw new ApiError("Input required to search properties", 400);
  }

  let words = propertyName.trim().split(/\s+/);

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
          ],
        })),
      },
    }),
  ]);

  if (!properties.length) {
    throw new ApiError("No properties found here", 404);
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
