import { v4 as uuidv4 } from "uuid";
import prisma from "../utils/db.ts";
import { ApiError, ApiResponse, asyncHandler } from "../utils/index.ts";

type BedPayload = { roomId: string; bedNo: number };

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

  const CHUNK = 1000;

  const property = await prisma.property.findUnique({
    where: {
      id: propertyId,
    },
  });

  if (!property) {
    throw new ApiError("Property not found", 404);
  }

  if (req.user?.id !== property?.adminId) {
    throw new ApiError("Forbidden", 403);
  }

  const MAX_ROOMS = 250;
  const MAX_BEDS = 100;

  if (numberOfRooms > MAX_ROOMS || bedsPerRoom > MAX_BEDS) {
    throw new ApiError(
      `Limits: Number of rooms can't be more than ${MAX_ROOMS}, Number of beds per room can't be more than ${MAX_BEDS}`,
      400,
    );
  }

  const roomTemplate = await prisma.$transaction(async (tx) => {
    const roomTemplate = await tx.roomTemplate.create({
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

    const batchId = uuidv4();

    const roomsPayload = Array.from({ length: numberOfRooms }, (_, i) => ({
      title: `Room ${i + 1}`,
      bedCount: bedsPerRoom,
      pricePerBed: pricePerBed,
      propertyId: propertyId,
      roomTemplateId: roomTemplate.id,
      batchId,
    }));

    for (let i = 0; i < roomsPayload.length; i += CHUNK) {
      const chunk = roomsPayload.slice(i, i + CHUNK);
      const rooms = await tx.room.createMany({
        data: chunk,
        skipDuplicates: true,
      });
    }

    const createdRooms = await tx.room.findMany({
      where: {
        roomTemplateId: roomTemplate.id,
        batchId,
      },
      select: {
        id: true,
        bedCount: true,
      },
    });

    if (createdRooms.length === 0) {
      throw new ApiError("Rooms aren't available", 400);
    }

    const bedsPayload: BedPayload[] = createdRooms.flatMap((room) => {
      return Array.from({ length: room.bedCount }, (_, j) => ({
        roomId: room.id,
        bedNo: j + 1,
      }));
    });

    if (bedsPayload.length === 0) throw new ApiError("No beds available", 400);

    for (let i = 0; i < bedsPayload.length; i += CHUNK) {
      const chunk = bedsPayload.slice(i, i + CHUNK);
      await tx.bed.createMany({ data: chunk, skipDuplicates: true });
    }

    return roomTemplate;
  });

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
      rooms: {
        select: {
          bedCount: true,
          description: true,
          pricePerBed: true,
          title: true,
        },
      },
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
  const { title, description, pricePerBed, type, amenities, image } = req.body;

  if (!roomTemplateId || !propertyId) {
    throw new ApiError("Room Template and Property ID is required", 400);
  }

  const property = await prisma.property.findUnique({
    where: {
      id: propertyId,
    },
  });

  if (!property) {
    throw new ApiError("Property not found", 404);
  }

  if (req.user?.id !== property?.adminId) {
    throw new ApiError("Forbidden", 403);
  }

  const roomTemplate = await prisma.roomTemplate.findUnique({
    where: {
      id: roomTemplateId,
    },
  });

  if (roomTemplate?.propertyId !== propertyId) {
    throw new ApiError("Forbidden", 403);
  }

  const updateRoomTemplate = await prisma.roomTemplate.update({
    where: {
      id: roomTemplateId,
    },
    data: {
      title: title,
      description: description,
      pricePerBed: pricePerBed,
      type: type,
      amenities: amenities,
      image: image,
    },
  });

  await prisma.room.updateMany({
    where: {
      roomTemplateId,
    },
    data: {
      pricePerBed,
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

  if (!roomTemplateId || !propertyId) {
    throw new ApiError("Room Template and Property ID is required", 400);
  }

  const property = await prisma.property.findUnique({
    where: {
      id: propertyId,
    },
  });

  if (!property) {
    throw new ApiError("Property not found", 404);
  }

  const roomTemplate = await prisma.roomTemplate.findUnique({
    where: {
      id: roomTemplateId,
    },
  });

  if (!roomTemplate) {
    throw new ApiError("Room Template is not found", 404);
  }

  if (req.user?.id !== property?.adminId) {
    throw new ApiError("Forbidden", 403);
  }

  if (roomTemplate.propertyId !== propertyId) {
    throw new ApiError("Forbidden", 403);
  }

  const deleteRoomTemplate = await prisma.$transaction(async (tx) => {
    const deleteRoomTemplate = await tx.roomTemplate.update({
      where: {
        id: roomTemplateId,
      },
      data: {
        deletedAt: new Date(),
      },
    });

    if (!deleteRoomTemplate) {
      throw new ApiError("Room Template not found", 404);
    }

    await tx.room.updateMany({
      where: {
        roomTemplateId: roomTemplateId,
      },
      data: {
        deletedAt: new Date(),
      },
    });

    const rooms = await tx.room.findMany({
      where: {
        roomTemplateId: roomTemplateId,
      },
    });

    rooms.flatMap(
      async (room) =>
        await tx.bed.updateMany({
          where: {
            roomId: room.id,
          },
          data: {
            deletedAt: new Date(),
          },
        }),
    );
  });

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
