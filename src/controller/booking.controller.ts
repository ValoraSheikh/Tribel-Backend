import prisma from "../utils/db.ts";
import { ApiError, ApiResponse, asyncHandler } from "../utils/index.ts";

export const createBooking = asyncHandler(async (req, res) => {
  const { propertyId, roomTemplateId, startDate, endDate } = req.body;

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
    console.log("Things are repeated in here 🥰");
    return res
      .status(existingKey.responseStatus)
      .json(existingKey.reponsesBody);
  }

  console.log("Things are not repeated in here🤢🤮");

  if (!propertyId) throw new ApiError("Property ID is missing", 400);

  if (startDate.getTime() < Date.now()) {
    throw new ApiError("Start date should be bigger than today's date", 400);
  }

  if (startDate > endDate) {
    throw new ApiError("Start date must be bigger than end date", 400);
  }

  const bookingCreated = await prisma.$transaction(
    async (tx) => {
      if (!req.user?.id) throw new ApiError("User ID is missing", 401);

      const Property = await tx.property.findUnique({
        where: {
          id: propertyId,
        },
      });

      const RoomTemplate = await tx.roomTemplate.findUnique({
        where: {
          id: roomTemplateId,
        },
        select: {
          propertyId: true,
        },
      });

      const rooms = await tx.room.findMany({
        where: {
          roomTemplateId: roomTemplateId,
        },
      });

      if (rooms.length === 0) {
        throw new ApiError("No rooms found", 404);
      }

      if (!rooms || !Property || !RoomTemplate)
        throw new ApiError("Property, Room template and Room not found", 404);

      if (RoomTemplate.propertyId !== Property.id)
        throw new ApiError("Room template doesn't belong to Property", 400);

      const beds = await tx.bed.findMany({
        where: {
          roomId: { in: rooms.map((r) => r.id) },
        },
      });

      const bedIds = beds.map((bed) => bed.id);

      const isOccupied = await tx.booking.findMany({
        where: {
          bedId: { in: bedIds },
          startDate: { lte: endDate },
          endDate: { gte: startDate },
        },
        select: {
          bedId: true,
        },
      });

      const unavailableBeds = new Set(isOccupied.map((b) => b.bedId));
      const freeBeds = beds.filter((bed) => !unavailableBeds.has(bed.id));

      if (freeBeds.length === 0) {
        throw new ApiError("All beds are Booked", 400);
      }

      const chooseBed = freeBeds[0];
      const selectRoom = rooms.find((r) => r.id === chooseBed?.roomId);

      if (!chooseBed) {
        throw new ApiError("No bed available", 400);
      }

      if (!selectRoom) {
        throw new ApiError("No room available", 400);
      }

      const booking = await tx.booking.create({
        data: {
          propertyId: propertyId,
          roomId: selectRoom?.id,
          bedId: chooseBed.id,
          guestId: req.user?.id,
          totalPrice: selectRoom?.pricePerBed,
          startDate,
          endDate,
          status: "CONFIRMED",
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
      isolationLevel: "Serializable",
    },
  );

  return res
    .status(201)
    .json(new ApiResponse(bookingCreated, "Booking created successfully", 201));
});

export const cancelBooking = asyncHandler(async (req, res) => {
  const { bookingId } = req.body;

  if (!bookingId) throw new ApiError("Booking ID is missing", 400);

  const booking = await prisma.booking.findUnique({
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

  const property = await prisma.property.findUnique({
    where: {
      id: propertyId,
    },
  });

  if (!property) throw new ApiError("No property found with this ID", 404);

  if (req.user?.id !== property.adminId)
    throw new ApiError("You are not allowed to take this action", 403);

  const booking = await prisma.booking.update({
    where: {
      id: bookingId,
      propertyId: propertyId,
    },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
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

  if (!req.user?.id) {
    throw new ApiError("User ID is missing", 401);
  }

  const bookings = await prisma.booking.findMany({
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
  });

  if (!bookings) {
    return res.status(404).json(new ApiResponse([], "No bookings found", 404));
  }

  const totalBookings = await prisma.booking.count({
    where: {
      guestId: req.user.id,
    },
  });

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

  const Property = await prisma.property.findUnique({
    where: {
      id: propertyId,
    },
  });

  if (req.user?.id !== Property?.adminId) {
    throw new ApiError("Forbidden", 403);
  }

  const bookings = await prisma.booking.findMany({
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
  });

  if (!bookings) {
    return res.status(404).json(new ApiResponse([], "No bookings found", 404));
  }

  const totalBookings = await prisma.booking.count({
    where: {
      propertyId: propertyId,
    },
  });

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

  const updateBooking = await prisma.booking.update({
    where: {
      id: bookingId,
    },
    data: {
      startDate: startDate,
      endDate: endDate,
    },
  });

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

  const superAdmin = await prisma.user.findUnique({
    where: {
      id: req.user?.id,
    },
  });

  if (superAdmin?.role !== "Super_Admin") {
    throw new ApiError("Forbidden", 403);
  }

  const bookings = await prisma.booking.findMany({
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
  });

  if (!bookings.length) {
    throw new ApiError("No bookings found", 404);
  }

  const totalBookings = await prisma.booking.count();

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

  const bookingDetails = await prisma.booking.findUnique({
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
