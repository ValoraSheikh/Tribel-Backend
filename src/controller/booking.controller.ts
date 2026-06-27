import prisma from "../lib/prisma/db.ts";
import { ApiError, ApiResponse, asyncHandler } from "../lib/index.ts";
import { v4 as uuidv4 } from "uuid";
import { acquireLock, releaseLock } from "../lib/redis/redis-lock.ts";
import { getSecuredClient } from "../lib/prisma/prisma-rls.ts";
import client from "../lib/redis/redis-cache.ts";

export const createBooking = asyncHandler(async (req, res) => {
  const { propertyId, roomTemplateId, startDate, endDate, paymentMode } =
    req.body;
  let key: string | undefined;
  const keyValue = uuidv4();
  const ttl = 5000;

  const idempotencyKey = req.get("Idempotency-key");

  if (!idempotencyKey) {
    throw new ApiError("Idempotency key is missing", 400);
  }

  const existingKey = await prisma.idempotencyKey.findUnique({
    where: {
      key: idempotencyKey,
    },
  });

  if (existingKey) {
    if (existingKey.userId !== req.user.id) {
      throw new ApiError("Invalid Idempotency key access", 400);
    }
    return res
      .status(existingKey.responseStatus)
      .json(existingKey.reponsesBody);
  }

  try {
    if (!propertyId) throw new ApiError("Property ID is missing", 400);

    if (startDate.getTime() < Date.now() - 24 * 60 * 60 * 1000) {
      throw new ApiError("Start date should be bigger than today's date", 400);
    }

    if (startDate > endDate) {
      throw new ApiError("Start date must be bigger than end date", 400);
    }

    const bookingCreated = await prisma.$transaction(
      async (tx) => {
        if (!req.user?.id) throw new ApiError("User ID is missing", 401);

        await tx.$executeRaw`
        SELECT set_config('app.current_userId', ${req.user.id}::text, true),
          set_config('app.current_user_auth0_id', ${req.oidc.user?.sub}::text, true)
        `;

        const freeBeds = await tx.$queryRaw<
          { id: string; roomId: string; pricePerBed: number }[]
        >`
        SELECT b.id, b."roomId", r."pricePerBed"
              FROM "Bed" b
              JOIN "Room" r ON b."roomId" = r.id
              WHERE r."roomTemplateId" = ${roomTemplateId}
              AND NOT EXISTS (
                  SELECT 1
                  FROM "Booking" bk
                  WHERE bk."bedId" = b.id
                  AND bk."startDate" < ${endDate}
                  AND bk."endDate" > ${startDate}
                  AND bk."status" IN ('UPCOMING', 'ONGOING', 'CONFIRMED')
              )
              LIMIT 1
              FOR NO KEY UPDATE OF b SKIP LOCKED;
        `;

        if (freeBeds.length === 0) {
          throw new ApiError("All beds are Booked", 400);
        }

        const chooseBed = freeBeds[0];

        if (!chooseBed?.id) {
          throw new ApiError("No bed available", 400);
        }

        key = `bed:lock${chooseBed.id}`;

        const lock = await acquireLock(key, keyValue, ttl);

        if (!lock) {
          throw new ApiError(
            "System is processing another booking for this room. Please retry.",
            429,
          );
        }

        const booking = await tx.booking.create({
          data: {
            propertyId: propertyId,
            roomId: chooseBed?.roomId,
            bedId: chooseBed.id,
            guestId: req.user?.id,
            totalPrice: chooseBed?.pricePerBed,
            startDate,
            endDate,
            status: "PENDING",
            paymentMode: paymentMode,
            paymentStatus: "PENDING",
          },
        });

        await tx.bed.update({
          where: {
            id: chooseBed.id,
          },
          data: {
            userId: req.user.id,
          },
        });

        await tx.idempotencyKey.create({
          data: {
            key: idempotencyKey,
            userId: req.user.id,
            reponsesBody: booking,
            responseStatus: 201,
            path: req.originalUrl,
            method: req.method,
          },
        });

        return {
          booking,
        };
      },
      {
        maxWait: 10000,
        timeout: 10000,
      },
    );

    await client.del(`roomTemplateDetail:${roomTemplateId}`);

    return res
      .status(201)
      .json(
        new ApiResponse(bookingCreated, "Booking created successfully", 201),
      );
  } catch (err) {
    throw new ApiError(`Failed to create booking ${err}`, 400);
  } finally {
    await releaseLock(key!, keyValue);
  }
});

export const cancelBooking = asyncHandler(async (req, res) => {
  const { bookingId } = req.body;

  if (!bookingId) throw new ApiError("Booking ID is missing", 400);

  const securedDB = getSecuredClient({
    userId: req.user.id,
    tenantId: "",
    role: "",
    auth0Id: req.oidc.user?.sub,
  });

  const booking = await securedDB.booking.findUnique({
    where: {
      id: bookingId,
    },
  });

  if (!booking) {
    throw new ApiError("No booking found with this ID", 404);
  }

  if (booking.startDate <= new Date()) {
    throw new ApiError("Can't cancel past and ongoing booking", 400);
  }

  if (booking?.cancelledAt !== null)
    throw new ApiError("Booking already cancelled", 400);

  if (req.user?.id !== booking?.guestId) throw new ApiError("Forbidden", 403);

  const cancelBooking = await prisma.booking.update({
    where: {
      id: bookingId,
    },
    data: {
      cancelledAt: new Date(),
      status: "CANCELLED",
    },
  });

  await prisma.bed.update({
    where: {
      id: booking.bedId,
    },
    data: {
      userId: null,
    },
  });

  return res
    .status(200)
    .json(new ApiResponse(cancelBooking, "Booking cancel successfully", 200));
});

export const cancelAdminBooking = asyncHandler(async (req, res) => {
  const { propertyId } = req.params;
  const { bookingId } = req.body;

  if (!propertyId || !bookingId)
    throw new ApiError("Property and Booking ID is required", 400);

  const securedDB = getSecuredClient({
    userId: req.user.id,
    tenantId: "",
    role: "",
    auth0Id: req.oidc.user?.sub,
  });

  const [user, property] = await Promise.all([
    securedDB.user.findUnique({
      where: {
        id: req.user.id,
      },
      select: {
        tenant: true,
        role: true,
        auth0Id: true,
        id: true,
      },
    }),

    prisma.property.findUnique({
      where: {
        id: propertyId,
      },
    }),
  ]);

  if (!user || !property)
    throw new ApiError("No user and property found with this ID", 404);

  const tenant = user.tenant;

  if (!tenant) {
    throw new ApiError("Tenant not found", 404);
  }

  if (req.user?.id !== property.adminId)
    throw new ApiError("You are not allowed to take this action", 403);

  const withRLS = getSecuredClient({
    userId: user.id,
    tenantId: tenant?.id,
    role: user?.role,
    auth0Id: user.auth0Id,
  });

  const booking = await withRLS.booking.update({
    where: {
      id: bookingId,
      propertyId: propertyId,
    },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
    },
  });

  await prisma.bed.update({
    where: {
      id: booking.bedId,
    },
    data: {
      userId: null,
    },
  });

  if (!booking) throw new ApiError("No booking found", 404);

  return res
    .status(200)
    .json(new ApiResponse([], "Booking cancelled successfully", 200));
});

export const getUserBookings = asyncHandler(async (req, res) => {
  let page = parseInt(req.query.page as string) || 1;
  let limit = parseInt(req.query.limit as string) || 10;
  limit = Math.min(Math.max(limit, 1), 50);
  let skip = (page - 1) * limit;

  if (!req.user?.id) throw new ApiError("User ID is missing", 401);

  const securedDB = getSecuredClient({
    userId: req.user.id,
    tenantId: "",
    role: "",
    auth0Id: req.oidc.user?.sub,
  });

  const [bookings, totalBookings] = await Promise.all([
    securedDB.booking.findMany({
      where: {
        guestId: req.user?.id,
      },
      select: {
        id: true,
        startDate: true,
        endDate: true,
        totalPrice: true,
        roomId: true,
        bedId: true,
        status: true,
        paymentMode: true,
        paymentStatus: true,
        guest: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phoneNo: true,
          },
        },
        bed: {
          select: {
            id: true,
            bedNo: true,
            roomId: true,
          },
        },
        room: {
          select: {
            id: true,
            title: true,
          },
        },
        createdAt: true,
        property: {
          select: {
            id: true,
            title: true,
            address: true,
            state: true,
            city: true,
            images: true,
          },
        },
      },
      take: limit,
      skip: skip,
      orderBy: { startDate: "desc" },
    }),

    securedDB.booking.count({
      where: {
        guestId: req.user.id,
      },
    }),
  ]);

  if (!bookings) {
    return res.status(404).json(new ApiResponse([], "No bookings found", 404));
  }

  return res.status(200).json(
    new ApiResponse(
      {
        bookings: bookings,
        page,
        totalBookings: totalBookings,
        totalPages: Math.ceil(totalBookings / limit),
      },
      "Bookings fetched successfully",
      200,
    ),
  );
});

export const getBookingsForAdmin = asyncHandler(async (req, res) => {
  const { propertyId } = req.params;
  let page = parseInt(req.query.page as string) || 1;
  let limit = parseInt(req.query.limit as string) || 10;
  let skip = (page - 1) * limit;
  limit = Math.min(Math.max(limit, 1), 50);

  if (!propertyId) {
    throw new ApiError("Property ID is missing", 400);
  }

  const securedDB = getSecuredClient({
    userId: req.user.id,
    tenantId: "",
    role: "",
    auth0Id: req.oidc.user?.sub,
  });

  const [user, property] = await Promise.all([
    securedDB.user.findUnique({
      where: {
        id: req.user.id,
      },
      select: {
        tenant: true,
        role: true,
        auth0Id: true,
        id: true,
      },
    }),

    prisma.property.findUnique({
      where: {
        id: propertyId,
      },
    }),
  ]);

  if (!user || !property)
    throw new ApiError("No user and property found with this ID", 404);

  // const AdminBookingsCache = await client.get(`AdminBookings:${propertyId}`);
  // if (AdminBookingsCache) {
  //   return res
  //     .status(200)
  //     .json(
  //       new ApiResponse(
  //         JSON.parse(AdminBookingsCache),
  //         "Bookings fetched successfully",
  //         200,
  //       ),
  //     );
  // }

  const tenant = user.tenant;

  if (!tenant) {
    throw new ApiError("Tenant not found", 404);
  }

  if (user?.id !== property?.adminId) {
    throw new ApiError("Forbidden", 403);
  }

  const withRLS = getSecuredClient({
    userId: user.id,
    tenantId: tenant.id,
    role: user.role,
    auth0Id: user.auth0Id,
  });

  const [bookings, totalBookings] = await Promise.all([
    withRLS.booking.findMany({
      where: {
        propertyId,
      },
      select: {
        id: true,
        startDate: true,
        endDate: true,
        totalPrice: true,
        roomId: true,
        bedId: true,
        status: true,
        paymentMode: true,
        paymentStatus: true,
        guest: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phoneNo: true,
          },
        },
        bed: {
          select: {
            id: true,
            bedNo: true,
            roomId: true,
          },
        },
        room: {
          select: {
            id: true,
            title: true,
          },
        },
        createdAt: true,
        property: {
          select: {
            id: true,
            title: true,
            address: true,
            state: true,
            city: true,
            images: true,
          },
        },
      },
      take: limit,
      skip: skip,
      orderBy: { startDate: "desc" },
    }),

    withRLS.booking.count({
      where: {
        propertyId: propertyId,
      },
    }),
  ]);

  if (!bookings) {
    return res.status(404).json(new ApiResponse([], "No bookings found", 404));
  }

  await client.set(
    `AdminBookings:${propertyId}`,
    JSON.stringify({
      bookings: bookings,
      page,
      totalBookings: totalBookings,
      totalPages: Math.ceil(totalBookings / limit),
    }),
    "EX",
    3600,
  );

  return res.status(200).json(
    new ApiResponse(
      {
        bookings: bookings,
        page,
        totalBookings: totalBookings,
        totalPages: Math.ceil(totalBookings / limit),
      },
      "Bookings fetched successfully",
      200,
    ),
  );
});

export const updateUserBooking = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.body;
  const { bookingId } = req.params;

  if (!endDate || !startDate) {
    throw new ApiError("Start and end date is required", 400);
  }

  if (!req.user?.id) {
    throw new ApiError("User ID is required", 401);
  }

  const UserBookingCache = await client.get(`UserBookings:${bookingId}`);
  if (UserBookingCache) {
    return res
      .status(200)
      .json(
        new ApiResponse(
          JSON.parse(UserBookingCache),
          "Booking updated successfully",
          200,
        ),
      );
  }

  if (!bookingId) {
    throw new ApiError("Booking ID is missing", 400);
  }

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
  });

  if (!booking) {
    throw new ApiError("No booking found", 404);
  }

  if (booking.guestId !== req.user?.id) {
    throw new ApiError("Forbidden", 403);
  }

  const conflicts = await prisma.booking.findMany({
    where: {
      bedId: booking.bedId,
      id: { not: bookingId },
      startDate: { lte: endDate },
      endDate: { gte: startDate },
    },
    select: {
      bedId: true,
      startDate: true,
      endDate: true,
    },
  });

  if (conflicts.length > 0) {
    throw new ApiError("Selected dates are not available for this bed", 400);
  }

  const securedDB = getSecuredClient({
    userId: req.user.id,
    tenantId: "",
    role: "",
    auth0Id: req.oidc.user?.sub,
  });

  const updateBooking = await securedDB.booking.update({
    where: {
      id: bookingId,
    },
    data: {
      startDate: startDate,
      endDate: endDate,
    },
    select: {
      id: true,
      startDate: true,
      endDate: true,
      totalPrice: true,
      roomId: true,
      bedId: true,
      status: true,
      paymentMode: true,
      paymentStatus: true,
      guest: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phoneNo: true,
        },
      },
      bed: {
        select: {
          id: true,
          bedNo: true,
          roomId: true,
        },
      },
      room: {
        select: {
          id: true,
          title: true,
        },
      },
      createdAt: true,
      property: {
        select: {
          id: true,
          title: true,
          address: true,
          state: true,
          city: true,
          images: true,
        },
      },
    },
  });

  await client.set(
    `UserBooking:${bookingId}`,
    JSON.stringify(updateBooking),
    "EX",
    3600,
  );

  return res
    .status(200)
    .json(new ApiResponse(updateBooking, "Booking updated successfully", 200));
});

export const getAllBooking = asyncHandler(async (req, res) => {
  let page = parseInt(req.query.page as string) || 1;
  let limit = parseInt(req.query.limit as string) || 10;
  let skip = (page - 1) * limit;
  limit = Math.min(Math.max(limit, 1), 50);

  if (!req.user?.id) {
    throw new ApiError("User ID is missing", 401);
  }

  const securedDB = getSecuredClient({
    userId: req.user.id,
    tenantId: "",
    role: "",
    auth0Id: req.oidc.user?.sub,
  });

  const user = await securedDB.user.findUnique({
    where: {
      id: req.user?.id,
    },
    select: {
      id: true,
      role: true,
      auth0Id: true,
    },
  });

  if (user?.role !== "Super_Admin") {
    throw new ApiError("Forbidden", 403);
  }

  const withRLS = getSecuredClient({
    userId: user.id,
    tenantId: "",
    role: user.role,
    auth0Id: user?.auth0Id,
  });

  const [bookings, totalBookings] = await Promise.all([
    withRLS.booking.findMany({
      select: {
        id: true,
        propertyId: true,
        roomId: true,
        guestId: true,
        status: true,
        totalPrice: true,
        startDate: true,
        endDate: true,
        createdAt: true,
        updatedAt: true,
        cancelledAt: true,
        bedId: true,
        paymentMode: true,
        paymentStatus: true,
        property: {
          select: {
            id: true,
            tenantId: true,
            type: true,
            address: true,
            gstin: true,
            city: true,
            state: true,
            country: true,
            postal_code: true,
            contact_email: true,
            contact_phone: true,
            createdAt: true,
            updatedAt: true,
            deletedAt: true,
            images: true,
            latitude: true,
            longitude: true,
            amenities: true,
            description: true,
            title: true,
            starRating: true,
            adminId: true,
          },
        },
        guest: {
          select: {
            id: true,
            email: true,
            avatar: true,
            createdAt: true,
            firstName: true,
            lastName: true,
            phoneNo: true,
            role: true,
            updatedAt: true,
          },
        },
        room: {
          select: {
            id: true,
            propertyId: true,
            createdAt: true,
            updatedAt: true,
            deletedAt: true,
            bedCount: true,
            description: true,
            pricePerBed: true,
            roomTemplateId: true,
            title: true,
            batchId: true,
          },
        },
      },
      take: limit,
      skip: skip,
      orderBy: {
        createdAt: "desc",
      },
    }),
    withRLS.booking.count(),
  ]);

  if (!bookings.length) {
    throw new ApiError("No bookings found", 404);
  }

  return res.status(200).json(
    new ApiResponse(
      {
        bookings: bookings,
        page,
        totalBookings: totalBookings,
        totalPages: Math.ceil(totalBookings / limit),
      },
      "Bookings fetch successfully",
      200,
    ),
  );
});

export const getBookingDetails = asyncHandler(async (req, res) => {
  const { bookingId } = req.body;

  const securedDB = getSecuredClient({
    userId: req.user.id,
    tenantId: "",
    role: "",
    auth0Id: req.oidc.user?.sub,
  });

  const user = await securedDB.user.findUnique({
    where: {
      id: req.user?.id,
    },
    select: {
      id: true,
      role: true,
      auth0Id: true,
      tenant: true,
    },
  });

  if (!user) {
    throw new ApiError("User not found", 403);
  }

  const tenantId = user.tenant?.id || "";

  const withRLS = getSecuredClient({
    userId: user.id,
    tenantId: tenantId || "",
    role: user.role,
    auth0Id: user?.auth0Id,
  });

  const bookingDetails = await withRLS.booking.findUnique({
    where: {
      id: bookingId,
    },
    select: {
      id: true,
      startDate: true,
      endDate: true,
      totalPrice: true,
      roomId: true,
      bedId: true,
      status: true,
      paymentMode: true,
      paymentStatus: true,
      guest: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phoneNo: true,
        },
      },
      bed: {
        select: {
          id: true,
          bedNo: true,
          roomId: true,
        },
      },
      room: {
        select: {
          id: true,
          title: true,
        },
      },
      createdAt: true,
      property: {
        select: {
          id: true,
          title: true,
          address: true,
          state: true,
          city: true,
          images: true,
        },
      },
    },
  });

  if (!bookingDetails) {
    throw new ApiError("No booking found with this ID", 404);
  }

  return res
    .status(200)
    .json(
      new ApiResponse(
        bookingDetails,
        "Booking details fetched successfully",
        200,
      ),
    );
});
