import prisma from "../utils/db.ts";
import { ApiError, ApiResponse, asyncHandler } from "../utils/index.ts";

export const createBooking = asyncHandler(async (req, res) => {
  const { roomId, totalPrice, startDate, endDate, bedId } = req.body;
  const { propertyId } = req.params;

  if (!req.user?.id) {
    throw new ApiError("User ID is missing", 401);
  }

  if (!propertyId || !roomId || !bedId) {
    throw new ApiError("Property ID is missing", 400);
  }

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

  if (!Room || !Bed || !Property)
    throw new ApiError("Property/Room/Bed not found", 404);

  if (Bed.roomId !== Room.id)
    throw new ApiError("Bed does not belong to room", 400);

  if (Room.propertyId !== Property.id)
    throw new ApiError("Room does not belong to property", 400);

  if (!Bed || !Room || !Property) {
    throw new ApiError("Property, Room and Bed not found", 404);
  }

  const booking = await prisma.booking.create({
    data: {
      propertyId: propertyId,
      roomId: roomId,
      bedId: bedId,
      guestId: req.user.id,
      totalPrice: totalPrice,
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
  const { bookingId } = req.body;

  if (!bookingId) throw new ApiError("Booking ID is missing", 400);

  const booking = await prisma.booking.findUnique({
    where: {
      id: bookingId,
    },
  });

  if (booking?.cancelledAt !== null) {
    throw new ApiError("Booking already cancelled", 400);
  }

  if (!booking) {
    throw new ApiError("Booking not found", 400);
  }

  if (req.user?.id !== booking?.guestId) {
    throw new ApiError("Forbidden", 403);
  }

  const cancelBooking = await prisma.booking.update({
    where: {
      id: bookingId,
    },
    data: {
      cancelledAt: new Date(),
    },
  });

  return res
    .status(200)
    .json(new ApiResponse(cancelBooking, "Booking cancel successfully", 200));
});

export const getUserBookings = asyncHandler(async (req, res) => {
  if (!req.user?.id) {
    throw new ApiError("User ID is missing", 401);
  }

  const bookings = await prisma.booking.findMany({
    where: {
      guestId: req.user?.id,
    },
  });

  return res
    .status(200)
    .json(new ApiResponse(bookings, "Bookings fetched successfully", 200));
});

export const getUserBookingsForAdmin = asyncHandler(async (req, res) => {
  const { propertyId } = req.body;

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
  });

  if (bookings.length === 0) {
    throw new ApiError("No confirmed booking", 400);
  }

  return res
    .status(200)
    .json(new ApiResponse(bookings, "Bookings fetched successfully", 200));
});
