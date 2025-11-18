import prisma from "../utils/db.ts";
import { ApiError, ApiResponse, asyncHandler } from "../utils/index.ts";

export const createBooking = asyncHandler(async (req, res) => {
  const { roomId, startDate, endDate, bedId } = req.body;
  const { propertyId } = req.params;

  if (!req.user?.id) throw new ApiError("User ID is missing", 401);

  if (!propertyId || !roomId || !bedId)
    throw new ApiError("Property ID is missing", 400);

  const Property = await prisma.property.findUnique({
    where: {
      id: propertyId,
    },
  });

  const Room = await prisma.room.findUnique({
    where: {
      id: roomId,
    },
  });

  const Bed = await prisma.bed.findUnique({
    where: {
      id: bedId,
    },
  });

  if (!Bed || !Room || !Property)
    throw new ApiError("Property, Room and Bed not found", 404);

  if (Bed.roomId !== Room.id)
    throw new ApiError("Bed does not belong to room", 400);

  if (Room.propertyId !== Property.id)
    throw new ApiError("Room does not belong to property", 400);

  if (Bed.userId !== null) throw new ApiError("Bed is already Booked", 400);

  const booking = await prisma.booking.create({
    data: {
      propertyId: propertyId,
      roomId: roomId,
      bedId: bedId,
      guestId: req.user.id,
      totalPrice: Room.pricePerBed,
      startDate,
      endDate,
      status: "CONFIRMED",
    },
  });

  return res
    .status(201)
    .json(new ApiResponse(booking, "Booking created successfully", 201));
});

export const cancelBooking = asyncHandler(async (req, res) => {
  const { bookingId, bedId } = req.body;

  if (!bookingId || !bedId)
    throw new ApiError("Booking and Bed ID is missing", 400);

  const booking = await prisma.booking.findUnique({
    where: {
      id: bookingId,
    },
  });

  const bed = await prisma.bed.findUnique({
    where: {
      id: bedId,
    },
  });

  if (!bed) throw new ApiError("Bed not found", 404);

  if (bed.userId !== req.user?.id) throw new ApiError("Forbidden", 403);

  if (booking?.cancelledAt !== null)
    throw new ApiError("Booking already cancelled", 400);

  if (!booking) throw new ApiError("Booking not found", 400);

  if (req.user?.id !== booking?.guestId) throw new ApiError("Forbidden", 403);

  if (booking.startDate <= new Date()) {
    throw new ApiError("Can't cancel past and ongoing booking", 400);
  }

  const cancelBooking = await prisma.booking.update({
    where: {
      id: bookingId,
    },
    data: {
      cancelledAt: new Date(),
    },
  });

  await prisma.bed.update({
    where: {
      id: bedId,
    },
    data: {
      userId: null,
    },
  });

  return res
    .status(200)
    .json(new ApiResponse(cancelBooking, "Booking cancel successfully", 200));
});

export const getUserBookings = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;

  if (!req.user?.id) {
    throw new ApiError("User ID is missing", 401);
  }

  const bookings = await prisma.booking.findMany({
    where: {
      guestId: req.user?.id,
    },
    take: limit,
    skip: skip,
    orderBy: { startDate: "desc" },
  });

  return res
    .status(200)
    .json(new ApiResponse(bookings, "Bookings fetched successfully", 200));
});

export const getUserBookingsForAdmin = asyncHandler(async (req, res) => {
  const { propertyId } = req.body;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;

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
    take: limit,
    skip: skip,
    orderBy: { startDate: "desc" },
  });

  if (bookings.length === 0) {
    throw new ApiError("No confirmed booking", 400);
  }

  return res
    .status(200)
    .json(new ApiResponse(bookings, "Bookings fetched successfully", 200));
});
