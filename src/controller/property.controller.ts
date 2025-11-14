import prisma from "../utils/db.ts";
import { ApiError, ApiResponse, asyncHandler } from "../utils/index.ts";

export const createProperty = asyncHandler(async (req, res) => {
  const { tenantId } = req.params;
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

  if (!tenantId) {
    throw new ApiError("Tenant ID is required", 400);
  }

  const tenant = await prisma.tenant.findUnique({
    where: {
      id: tenantId,
    },
  });

  if (!tenant) {
    throw new ApiError("Tenant not found", 404);
  }

  if (req.user?.id !== tenant?.userId) {
    throw new ApiError("Forbidden", 403);
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

export const getPropertyDetail = asyncHandler(async (req, res) => {
  const { propertyId } = req.params;

  if (!propertyId) {
    throw new ApiError("Property ID is required", 400);
  }

  const property = await prisma.property.findUnique({
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

  if (!property) {
    throw new ApiError("No property found with this ID", 404);
  }

  return res
    .status(200)
    .json(new ApiResponse(property, "Property fetched Successfully", 200));
});

export const getAllProperties = asyncHandler(async (_req, res) => {
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
  });

  return res
    .status(200)
    .json(
      new ApiResponse(properties, "Fetched all properties Successfully", 200),
    );
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

  const { tenantId, propertyId } = req.params;

  if (!tenantId || !propertyId) {
    throw new ApiError("Tenant and Property ID is required", 400);
  }

  if (!req.user?.id) {
    throw new ApiError("User ID is missing", 401);
  }

  const owner = await prisma.user.findUnique({
    where: {
      id: req.user.id,
    },
  });

  const tenantOwner = await prisma.tenant.findUnique({
    where: {
      id: tenantId,
    },
  });

  if (owner?.id !== tenantOwner?.userId) {
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
  const { tenantId, propertyId } = req.params;

  if (!tenantId || !propertyId) {
    throw new ApiError("Tenant and Property ID is required", 400);
  }

  if (!req.user?.id) {
    throw new ApiError("User ID is missing", 401);
  }

  const owner = await prisma.user.findUnique({
    where: {
      id: req.user.id,
    },
  });

  const tenantOwner = await prisma.tenant.findUnique({
    where: {
      id: tenantId,
    },
  });

  if (owner?.id !== tenantOwner?.userId) {
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
