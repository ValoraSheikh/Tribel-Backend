import { v4 as uuidv4 } from "uuid";
import prisma from "../lib/prisma/db.ts";
import { ApiError, ApiResponse, asyncHandler } from "../lib/index.ts";
import { getSecuredClient } from "../lib/prisma/prisma-rls.ts";
import client from "../lib/redis/redis-cache.ts";

type BedPayload = Promise<{ roomId: string; bedNo: number }[]>;

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

  const MAX_ROOMS = 250;
  const MAX_BEDS = 100;

  if (numberOfRooms > MAX_ROOMS || bedsPerRoom > MAX_BEDS) {
    throw new ApiError(
      `Limits: Number of rooms can't be more than ${MAX_ROOMS},
      Number of beds per room can't be more than ${MAX_BEDS}`,
      400,
    );
  }

  const secureDB = getSecuredClient({
    userId: req.user.id,
    tenantId: "",
    role: "",
    auth0Id: req.oidc.user?.id,
  });

  const [user, property] = await Promise.all([
    secureDB.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, tenant: true, role: true, auth0Id: true },
    }),
    prisma.property.findUnique({
      where: { id: propertyId },
    }),
  ]);

  if (!property || !user) {
    throw new ApiError("Property and user not found", 404);
  }

  if (req.user?.id !== property?.adminId) {
    throw new ApiError("Forbidden", 403);
  }

  const tenant = user.tenant;
  if (!tenant) throw new ApiError("Tenant not found", 404);

  const roomTemplate = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenant.id}, true);`;
      await tx.$executeRaw`SELECT set_config('app.current_userId', ${user.id}, true);`;
      await tx.$executeRaw`SELECT set_config('app.current_role', ${user.role}, true);`;
      await tx.$executeRaw`SELECT set_config('app.current_user_auth0_id', ${user?.auth0Id}::text, true);`;

      const createdTemplate = await tx.roomTemplate.create({
        data: {
          title,
          propertyId,
          description,
          bedsPerRoom,
          numberOfRooms,
          pricePerBed,
          type,
          amenities: amenities ?? [],
          image: image ?? [],
        },
        select: {
          id: true,
          title: true,
          image: true,
          description: true,
          amenities: true,
          bedsPerRoom: true,
          numberOfRooms: true,
          pricePerBed: true,
          createdAt: true,
          updatedAt: true,
          type: true,
          deletedAt: true,
          propertyId: true,
          rooms: {
            select: {
              id: true,
              title: true,
              description: true,
              pricePerBed: true,
              roomTemplateId: true,
              bedCount: true,
              propertyId: true,
              createdAt: true,
              updatedAt: true,
              beds: {
                select: {
                  id: true,
                  roomId: true,
                  bedNo: true,
                  createdAt: true,
                  updatedAt: true,
                  user: {
                    select: {
                      id: true,
                      firstName: true,
                      lastName: true,
                      avatar: true,
                      email: true,
                      phoneNo: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      const roomTemplateId = createdTemplate.id;
      const batchId = uuidv4();
      const now = new Date();

      await tx.$executeRaw`
      WITH inserted_rooms AS (
        INSERT INTO "Room" (
          "id", "title", "bedCount", "pricePerBed",
          "propertyId", "roomTemplateId", "batchId",
          "createdAt", "updatedAt"
        )
        SELECT
          gen_random_uuid(),
          'Room ' || i,
          ${bedsPerRoom},
          ${pricePerBed},
          ${propertyId},
          ${roomTemplateId},
          ${batchId},
          ${now},
          ${now}
        FROM generate_series(1, ${numberOfRooms}) AS t(i)
        RETURNING "id"
      )
      INSERT INTO "Bed" (
        "id", "roomId", "bedNo", "createdAt", "updatedAt"
      )
      SELECT
        gen_random_uuid(),
        r.id,
        s.bed_num,
        ${now},
        ${now}
      FROM inserted_rooms r
      CROSS JOIN generate_series(1, ${bedsPerRoom}) AS s(bed_num);
    `;

      return createdTemplate;
    },
    {
      maxWait: 5000,
      timeout: 10000,
    },
  );

  await client.del(`roomTemplates:${propertyId}`);
  await client.del(`roomTemplateDetail:${roomTemplate.id}`);

  return res
    .status(201)
    .json(
      new ApiResponse(roomTemplate, "Room Template created successfully", 201),
    );
});

export const getRoomTemplates = asyncHandler(async (req, res) => {
  const { propertyId } = req.params;

  if (!propertyId) {
    throw new ApiError("Property ID is required", 400);
  }

  const roomTemplateCache = await client.get(`roomTemplates:${propertyId}`);
  if (roomTemplateCache) {
    return res
      .status(200)
      .json(
        new ApiResponse(
          JSON.parse(roomTemplateCache),
          "Room Templates fetched successfully",
          200,
        ),
      );
  }

  const roomTemplates = await prisma.roomTemplate.findMany({
    where: {
      propertyId: propertyId,
    },
    select: {
      id: true,
      title: true,
      description: true,
      bedsPerRoom: true,
      numberOfRooms: true,
      pricePerBed: true,
      type: true,
      amenities: true,
      image: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  await client.set(
    `roomTemplates:${propertyId}`,
    JSON.stringify(roomTemplates),
    "EX",
    3600,
  );

  return res
    .status(200)
    .json(
      new ApiResponse(
        roomTemplates,
        "Room Templates fetched successfully",
        200,
      ),
    );
});

export const getRoomTemplateDetail = asyncHandler(async (req, res) => {
  const { roomTemplateId } = req.params;

  const roomTemplateDetailCache = await client.get(
    `roomTemplateDetail:${roomTemplateId}`,
  );

  if (roomTemplateDetailCache) {
    return res
      .status(200)
      .json(
        new ApiResponse(
          JSON.parse(roomTemplateDetailCache),
          "Room template details fetched successfully",
          200,
        ),
      );
  }

  const secureDB = getSecuredClient({
    userId: req.user.id,
    tenantId: "",
    role: "",
    auth0Id: req.oidc.user?.id,
  });

  const user = await secureDB.user.findUnique({
    where: {
      id: req.user.id,
    },
    select: {
      id: true,
      role: true,
      auth0Id: true,
      tenant: true,
    },
  });

  if (!user) throw new ApiError("User not found", 404);

  if (!roomTemplateId) {
    throw new ApiError("Room template ID is required", 400);
  }

  const tenant = user.tenant;

  if (!tenant) throw new ApiError("Tenant not found", 404);

  const withRLS = getSecuredClient({
    userId: user.id,
    auth0Id: user?.auth0Id,
    role: user?.role,
    tenantId: tenant.id,
  });

  const roomTemplateDetail = await withRLS.roomTemplate.findUnique({
    where: {
      id: roomTemplateId,
    },
    select: {
      id: true,
      title: true,
      image: true,
      description: true,
      amenities: true,
      bedsPerRoom: true,
      numberOfRooms: true,
      pricePerBed: true,
      createdAt: true,
      updatedAt: true,
      type: true,
      deletedAt: true,
      propertyId: true,
      rooms: {
        select: {
          id: true,
          title: true,
          description: true,
          pricePerBed: true,
          roomTemplateId: true,
          bedCount: true,
          propertyId: true,
          createdAt: true,
          updatedAt: true,
          beds: {
            select: {
              id: true,
              roomId: true,
              bedNo: true,
              createdAt: true,
              updatedAt: true,
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  avatar: true,
                  email: true,
                  phoneNo: true,
                },
              },
            },
          },
        },
      },
    },
  });

  await client.set(
    `roomTemplateDetail:${roomTemplateId}`,
    JSON.stringify(roomTemplateDetail),
    "EX",
    3600,
  );

  return res
    .status(200)
    .json(
      new ApiResponse(
        roomTemplateDetail,
        "Room template details fetched successfully",
        200,
      ),
    );
});

export const updateRoomTemplate = asyncHandler(async (req, res) => {
  const { roomTemplateId, propertyId } = req.params;
  const { title, description, pricePerBed, type, amenities, image } = req.body;

  if (!roomTemplateId || !propertyId) {
    throw new ApiError("Room Template and Property ID is required", 400);
  }

  const secureDB = getSecuredClient({
    userId: req.user.id,
    tenantId: "",
    role: "",
    auth0Id: req.oidc.user?.sub,
  });

  const [user, property, roomTemplate] = await Promise.all([
    secureDB.user.findUnique({
      where: {
        id: req.user.id,
      },
      select: {
        id: true,
        role: true,
        auth0Id: true,
        tenant: true,
      },
    }),
    prisma.property.findUnique({
      where: {
        id: propertyId,
      },
    }),
    prisma.roomTemplate.findUnique({
      where: {
        id: roomTemplateId,
      },
    }),
  ]);

  if (!property || !user) {
    throw new ApiError("Property and User not found", 404);
  }

  if (user?.id !== property?.adminId) {
    throw new ApiError("Forbidden", 403);
  }

  if (roomTemplate?.propertyId !== propertyId) {
    throw new ApiError("Forbidden", 403);
  }

  const tenant = user.tenant;

  if (!tenant) throw new ApiError("Tenant not found", 400);

  const withRLS = getSecuredClient({
    userId: req.user.id,
    tenantId: tenant?.id,
    role: user.role,
    auth0Id: req.oidc.user?.sub,
  });

  const [updateRoomTemplate] = await Promise.all([
    withRLS.roomTemplate.update({
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
      select: {
        id: true,
        title: true,
        description: true,
        bedsPerRoom: true,
        numberOfRooms: true,
        pricePerBed: true,
        type: true,
        amenities: true,
        image: true,
        createdAt: true,
        updatedAt: true,
        rooms: {
          select: {
            bedCount: true,
            description: true,
            pricePerBed: true,
            title: true,
          },
        },
      },
    }),
    prisma.room.updateMany({
      where: {
        roomTemplateId,
      },
      data: {
        pricePerBed,
      },
    }),
  ]);

  if (!updateRoomTemplate) {
    throw new ApiError("Room Template not found", 404);
  }

  await client.del(`roomTemplates:${propertyId}`);
  await client.del(`roomTemplateDetail:${roomTemplateId}`);

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

  const secureDB = getSecuredClient({
    userId: req.user.id,
    tenantId: "",
    role: "",
    auth0Id: req.oidc.user?.id,
  });

  const [user, roomTemplate] = await Promise.all([
    secureDB.user.findUnique({
      where: {
        id: req.user.id,
      },
      select: {
        id: true,
        tenant: true,
        role: true,
        auth0Id: true,
      },
    }),
    prisma.roomTemplate.findUnique({
      where: { id: roomTemplateId },
      include: {
        property: {
          select: { id: true, adminId: true },
        },
        rooms: {
          select: { id: true },
        },
      },
    }),
    secureDB.booking.deleteMany({
      where: {
        propertyId: propertyId,
      },
    }),
  ]);

  if (!user || !roomTemplate) {
    throw new ApiError("User and Room Template not found", 404);
  }

  if (roomTemplate.property.id !== propertyId) {
    throw new ApiError("Forbidden", 403);
  }

  if (req.user?.id !== roomTemplate.property.adminId) {
    throw new ApiError("Forbidden", 403);
  }

  const tenant = user.tenant;

  if (!tenant) throw new ApiError("Tenant not found", 404);

  const deletedTemplate = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`
      SELECT set_config('app.current_userId', ${req.user.id}::text, true),
        set_config('app.current_user_auth0_id', ${req.oidc.user?.sub}::text, true),
        set_config('app.current_userId', ${user?.id}::text, true),
        set_config('app.current_user_auth0_id', ${user?.auth0Id}::text, true)
      `;

      await Promise.all(
        roomTemplate.rooms.map((room: { id: string }) =>
          tx.bed.deleteMany({
            where: { roomId: room.id },
          }),
        ),
      );

      await tx.room.deleteMany({
        where: { roomTemplateId },
      });

      return tx.roomTemplate.delete({
        where: { id: roomTemplateId },
      });
    },
    {
      timeout: 20000,
      isolationLevel: "ReadUncommitted",
    },
  );

  await client.del(`roomTemplates:${propertyId}`);
  await client.del(`roomTemplateDetail:${roomTemplateId}`);

  return res
    .status(200)
    .json(
      new ApiResponse(
        deletedTemplate,
        "Room Template deleted successfully",
        200,
      ),
    );
});
