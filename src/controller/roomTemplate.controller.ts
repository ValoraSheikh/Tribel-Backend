import prisma from "../utils/db.ts";
import { ApiError, ApiResponse, asyncHandler } from "../utils/index.ts";

export const createRoomTemplate = asyncHandler(async (req, res) => {
  const { propertyId } = req.params;
  const {
    title,
    description,
    bedsPerRoom,
    numberOfRooms,
    pricePerBed,
    type,
    amenities,
    image,
  } = req.body;

  if (!propertyId) {
    throw new ApiError("Property ID is required", 400);
  }

  const property = await prisma.property.findUnique({
    where: {
      id: propertyId,
    },
  });

  if (!propertyId) {
    throw new ApiError("Property ID not found", 404);
  }

  if (req.user?.id !== property?.adminId) {
    throw new ApiError("Forbidden", 403);
  }

  const roomTemplate = await prisma.roomTemplate.create({
    data: {
      title: title,
      propertyId: propertyId,
      description: description,
      bedsPerRoom: bedsPerRoom,
      numberOfRooms: numberOfRooms,
      pricePerBed: pricePerBed,
      type: type,
      amenities: amenities,
      image: image,
    },
  });

  for (let i = 1; i <= roomTemplate.numberOfRooms; i++) {
    const createRooms = await prisma.room.create({
      data: {
        title: `Room ${i}`,
        bedCount: bedsPerRoom,
        pricePerBed: pricePerBed,
        propertyId: propertyId,
        roomTemplateId: roomTemplate.id,
      },
    });
  }

  return res
    .status(201)
    .json(
      new ApiResponse(roomTemplate, "Room Template created successfully", 201),
    );
});

export const getRoomTemplate = asyncHandler(async (req, res) => {
  const { propertyId } = req.params;

  if (!propertyId) {
    throw new ApiError("Property ID is required", 400);
  }

  const roomTemplate = await prisma.roomTemplate.findMany({
    where: {
      propertyId: propertyId,
    },
    select: {
      title: true,
      description: true,
      bedsPerRoom: true,
      numberOfRooms: true,
      pricePerBed: true,
      type: true,
      amenities: true,
      image: true,
    },
  });

  return res
    .status(200)
    .json(
      new ApiResponse(roomTemplate, "Room Templates fetched successfully", 200),
    );
});

export const updateRoomTemplate = asyncHandler(async (req, res) => {
  const { roomTemplateId, propertyId } = req.params;
  const {
    title,
    description,
    bedsPerRoom,
    numberOfRooms,
    pricePerBed,
    type,
    amenities,
    image,
  } = req.body;

  if (!roomTemplateId) {
    throw new ApiError("Room Template ID is required", 400);
  }
  if (!propertyId) {
    throw new ApiError("Property ID is required", 400);
  }

  const property = await prisma.property.findUnique({
    where: {
      id: propertyId,
    },
  });

  if (!propertyId) {
    throw new ApiError("Property ID not found", 404);
  }

  if (req.user?.id !== property?.adminId) {
    throw new ApiError("Forbidden", 403);
  }

  const updateRoomTemplate = await prisma.roomTemplate.update({
    where: {
      id: roomTemplateId,
    },
    data: {
      title: title,
      description: description,
      bedsPerRoom: bedsPerRoom,
      numberOfRooms: numberOfRooms,
      pricePerBed: pricePerBed,
      type: type,
      amenities: amenities,
      image: image,
    },
  });

  if (!updateRoomTemplate) {
    throw new ApiError("Room Template not found", 404);
  }

  return res
    .status(200)
    .json(
      new ApiResponse(
        updateRoomTemplate,
        "Room template updated successfully",
        200,
      ),
    );
});

export const deleteRoomTemplate = asyncHandler(async (req, res) => {
  const { roomTemplateId, propertyId } = req.params;

  if (!roomTemplateId) {
    throw new ApiError("Room Template ID is required", 400);
  }
  
  if (!propertyId) {
    throw new ApiError("Property ID is required", 400);
  }
  
  const property = await prisma.property.findUnique({
    where: {
      id: propertyId
    }
  })
  
  if (!propertyId) {
    throw new ApiError("Property ID not found", 404)
  }
  
  if (req.user?.id !== property?.adminId) {
    throw new ApiError("Forbidden", 403)
  }

  const deleteRoomTemplate = await prisma.roomTemplate.delete({
    where: {
      id: roomTemplateId,
    },
  });

  if (!deleteRoomTemplate) {
    throw new ApiError("Room Template not found", 404);
  }

  return res
    .status(200)
    .json(
      new ApiResponse(
        deleteRoomTemplate,
        "Room Template deleted successfully",
        200,
      ),
    );
});
