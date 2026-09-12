import prisma from "../lib/prisma/db.ts";
import { ApiError, ApiResponse, asyncHandler } from "../lib/index.ts";
import { getSecuredClient } from "../lib/prisma/prisma-rls.ts";
import client from "../lib/redis/redis-cache.ts";
import { deleteOccupancyCache } from "../lib/redis/occupancy-cache.ts";
import rabbitmq from "../lib/rabbitmq/config/rabbitmq.ts";
import {
  assertAdminCancellable,
  assertBedAssignable,
  assertDateChangeAllowed,
  assertGuestCancellable,
  assertMarkPaidAllowed,
  assertNoRefundInFlight,
  assertRefundAllowed,
  assertRefundWindowOpen,
  assertRefundWithinPaid,
  assertRejectable,
  computeBookingPrice,
  computeProratedSettlement,
  refundableBalance,
  resolveRefundMethod,
  summarizeRefunds,
} from "../services/booking-state.service.ts";
import { initiateGatewayRefund } from "../services/razorpay-refund.service.ts";
import type { PaymentProvider } from "../generated/prisma/client.ts";

const MAX_OCCUPANCY_WINDOW_DAYS = 62;

export const createBooking = asyncHandler(async (req, res) => {
  const {
    propertyId,
    roomTemplateId,
    startDate,
    endDate,
    paymentMode,
    phoneNo,
  } = req.body;

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

  if (!propertyId) throw new ApiError("Property ID is missing", 400);

  if (!roomTemplateId) throw new ApiError("Room template is missing", 400);

  if (startDate.getTime() < Date.now() - 24 * 60 * 60 * 1000) {
    throw new ApiError("Start date should be bigger than today's date", 400);
  }

  if (startDate >= endDate) {
    throw new ApiError("Check-out must be after check-in", 400);
  }

  // The room template row is locked for the duration of the transaction so
  // two concurrent guests cannot both pass the availability count when a
  // single slot remains. Bed-level conflicts are impossible via the
  // database exclusion constraint; this check guards the template-level
  // capacity for bookings that do not have a bed assigned yet.
  const bookingCreated = await prisma.$transaction(
    async (tx) => {
      if (!req.user?.id) throw new ApiError("User ID is missing", 401);

      await tx.$executeRaw`
        SELECT set_config('app.current_userId', ${req.user.id}::text, true),
          set_config('app.current_user_auth0_id', ${req.oidc.user?.sub}::text, true)
      `;

      const templateRows = await tx.$queryRaw<
        {
          id: string;
          pricePerBed: number;
          totalBeds: number;
        }[]
      >`
        SELECT id, "pricePerBed", ("numberOfRooms" * "bedsPerRoom") AS "totalBeds"
        FROM "RoomTemplate"
        WHERE id = ${roomTemplateId}
          AND "propertyId" = ${propertyId}
          AND "deletedAt" IS NULL
        FOR NO KEY UPDATE
      `;

      const template = templateRows[0];

      if (!template) {
        throw new ApiError("Room template not found for this property", 404);
      }

      const overlappingCount = await tx.booking.count({
        where: {
          roomTemplateId: roomTemplateId,
          status: { in: ["PENDING", "CONFIRMED", "ONGOING"] },
          startDate: { lt: endDate },
          endDate: { gt: startDate },
        },
      });

      if (overlappingCount >= template.totalBeds) {
        throw new ApiError(
          "This room type is sold out for the selected dates",
          400,
        );
      }

      const booking = await tx.booking.create({
        data: {
          propertyId: propertyId,
          roomTemplateId: roomTemplateId,
          guestId: req.user?.id,
          totalPrice: computeBookingPrice(
            template.pricePerBed,
            startDate,
            endDate,
          ).total,
          startDate,
          endDate,
          status: "PENDING",
          paymentMode: paymentMode,
          paymentStatus: "PENDING",
        },
      });

      // Save the guest's phone number on their profile the first time they
      // provide one during a booking.
      if (phoneNo) {
        const guest = await tx.user.findUnique({
          where: { id: req.user.id },
          select: { phoneNo: true },
        });
        if (guest && !guest.phoneNo) {
          await tx.user.update({
            where: { id: req.user.id },
            data: { phoneNo },
          });
        }
      }

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

  // Booking-received email for both payment modes — fire and forget so a
  // broker hiccup never fails a created booking. Invoices are generated at
  // admin approval, not here.
  const property = await prisma.property.findUnique({
    where: {
      id: propertyId,
    },
  });

  try {
    await rabbitmq({
      msg: JSON.stringify({
        bookingId: bookingCreated.booking.id,
        userId: req.user.id,
        auth0Id: req.oidc.user?.sub ?? "",
        tenantId: property?.tenantId ?? "",
      }),
      exchange: "tribel.events",
      routingKey: "email",
    });
  } catch (err) {
    console.error("Failed to emit booking email event", err);
  }

  await client.del(`roomTemplateDetail:${roomTemplateId}`);
  await client.del(`AdminBookings:${propertyId}`);
  await client.del(`user:${req.user.id}`);
  await deleteOccupancyCache(propertyId);

  return res
    .status(201)
    .json(
      new ApiResponse(bookingCreated, "Booking created successfully", 201),
    );
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
    select: {
      id: true,
      guestId: true,
      propertyId: true,
      status: true,
      startDate: true,
      endDate: true,
      paymentMode: true,
      paymentStatus: true,
      refunds: { select: { amount: true, status: true } },
      payments: { select: { amount: true, status: true } },
    },
  });

  if (!booking) {
    throw new ApiError("No booking found with this ID", 404);
  }

  assertGuestCancellable(booking);

  if (req.user?.id !== booking.guestId) throw new ApiError("Forbidden", 403);

  const cancelBooking = await prisma.booking.update({
    where: {
      id: bookingId,
    },
    data: {
      cancelledAt: new Date(),
      status: "CANCELLED",
    },
  });

  await client.del(`AdminBookings:${booking.propertyId}`);
  await deleteOccupancyCache(booking.propertyId);

  // What the property still holds for this guest. Recording the refund stays an
  // admin action, but the guest is told what is owed instead of guessing.
  const refundSummary = summarizeRefunds(booking.payments, booking.refunds);

  return res.status(200).json(
    new ApiResponse(
      {
        ...cancelBooking,
        refundRequired: refundSummary.refundableAmount > 0,
        refundSummary,
      },
      "Booking cancel successfully",
      200,
    ),
  );
});

export const cancelAdminBooking = asyncHandler(async (req, res) => {
  const { propertyId } = req.params as { propertyId: string };
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

  const existingBooking = await withRLS.booking.findUnique({
    where: {
      id: bookingId,
      propertyId: propertyId,
    },
    select: {
      id: true,
      status: true,
      paymentStatus: true,
      paymentMode: true,
      totalPrice: true,
      startDate: true,
      endDate: true,
      refunds: { select: { amount: true, status: true } },
      payments: { select: { amount: true, status: true } },
      roomTemplate: {
        select: { pricePerBed: true },
      },
    },
  });

  if (!existingBooking) {
    throw new ApiError("No booking found", 404);
  }

  assertAdminCancellable(existingBooking);

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

  await client.del(`AdminBookings:${propertyId}`);
  await deleteOccupancyCache(propertyId);

  const refundSummary = summarizeRefunds(
    existingBooking.payments,
    existingBooking.refunds,
  );

  let suggestedRefund: {
    nightsUsed: number | null;
    amountDue: number;
    refundAmount: number;
  } | null = null;

  if (refundSummary.refundableAmount > 0) {
    // Mid-stay cancels settle on the nights consumed; any other paid cancel
    // gives back everything still held. Either way the suggestion is capped by
    // the money actually collected and not already refunded, so the admin is
    // never nudged toward refunding more than the booking captured.
    if (existingBooking.status === "ONGOING") {
      const settlement = computeProratedSettlement({
        totalPrice: existingBooking.totalPrice,
        startDate: existingBooking.startDate,
        endDate: existingBooking.endDate,
        pricePerBed: existingBooking.roomTemplate.pricePerBed,
      });

      suggestedRefund = {
        ...settlement,
        refundAmount: Math.min(
          settlement.refundAmount,
          refundSummary.refundableAmount,
        ),
      };
    } else {
      suggestedRefund = {
        nightsUsed: null,
        amountDue: 0,
        refundAmount: refundSummary.refundableAmount,
      };
    }
  }

  return res
    .status(200)
    .json(
      new ApiResponse(
        {
          bookingId: booking.id,
          status: "CANCELLED",
          suggestedRefund,
          refundRequired: refundSummary.refundableAmount > 0,
          refundSummary,
        },
        "Booking cancelled successfully",
        200,
      ),
    );
});

export const getUserBookings = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page as string) || 1;
  let limit = parseInt(req.query.limit as string) || 10;
  limit = Math.min(Math.max(limit, 1), 50);
  const skip = (page - 1) * limit;

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
        refunds: { select: { amount: true, status: true } },
        payments: { select: { amount: true, status: true } },
        guest: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phoneNo: true,
            avatar: true,
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
        invoiceId: true,
        invoice: {
          select: {
            status: true,
          },
        },
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
      orderBy: { createdAt: "desc" },
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

  // Refund state is derived here, against the captured amount, so no client has
  // to compare refunds against the booking total — which lies for a partially
  // paid booking.
  const bookingsWithRefunds = bookings.map((booking) => ({
    ...booking,
    refundSummary: summarizeRefunds(booking.payments, booking.refunds),
  }));

  return res.status(200).json(
    new ApiResponse(
      {
        bookings: bookingsWithRefunds,
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
  const { propertyId } = req.params as { propertyId: string };
  const page = parseInt(req.query.page as string) || 1;
  let limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;
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
        refunds: { select: { amount: true, status: true } },
        payments: { select: { amount: true, status: true } },
        roomTemplateId: true,
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
        invoiceId: true,
        invoice: {
          select: {
            status: true,
          },
        },
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

  const bookingsWithRefunds = bookings.map((booking) => ({
    ...booking,
    refundSummary: summarizeRefunds(booking.payments, booking.refunds),
  }));

  await client.set(
    `AdminBookings:${propertyId}`,
    JSON.stringify({
      bookings: bookingsWithRefunds,
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
        bookings: bookingsWithRefunds,
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
  const { bookingId } = req.params as { bookingId: string };

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
  const page = parseInt(req.query.page as string) || 1;
  let limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;
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
        roomTemplateId: true,
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
  const { bookingId } = req.params as { bookingId: string };

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
      refunds: { select: { amount: true, status: true } },
      payments: { select: { amount: true, status: true } },
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
        {
          ...bookingDetails,
          refundSummary: summarizeRefunds(
            bookingDetails.payments,
            bookingDetails.refunds,
          ),
        },
        "Booking details fetched successfully",
        200,
      ),
    );
});

export const getOccupancy = asyncHandler(async (req, res) => {
  const { propertyId } = req.params as { propertyId: string };
  const query = req.query as unknown as {
    startDate?: Date | string;
    endDate?: Date | string;
  };

  if (!propertyId) {
    throw new ApiError("Property ID is missing", 400);
  }

  const now = new Date();
  const startDate = query.startDate
    ? new Date(query.startDate)
    : new Date(now.getFullYear(), now.getMonth(), 1);

  const endDate = query.endDate
    ? new Date(query.endDate)
    : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    throw new ApiError("Invalid start or end date", 400);
  }

  if (startDate > endDate) {
    throw new ApiError("Start date must be before end date", 400);
  }

  const windowMs = endDate.getTime() - startDate.getTime();
  if (windowMs > MAX_OCCUPANCY_WINDOW_DAYS * 24 * 60 * 60 * 1000) {
    throw new ApiError(
      `Occupancy window cannot exceed ${MAX_OCCUPANCY_WINDOW_DAYS} days`,
      400,
    );
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

  const tenant = user.tenant;

  if (!tenant) {
    throw new ApiError("Tenant not found", 404);
  }

  if (user.id !== property.adminId) {
    throw new ApiError("Forbidden", 403);
  }

  const cacheKey = `Occupancy:${propertyId}:${startDate.toISOString()}:${endDate.toISOString()}`;
  const cached = await client.get(cacheKey);
  if (cached) {
    return res
      .status(200)
      .json(
        new ApiResponse(
          JSON.parse(cached),
          "Occupancy fetched successfully",
          200,
        ),
      );
  }

  const withRLS = getSecuredClient({
    userId: user.id,
    tenantId: tenant.id,
    role: user.role,
    auth0Id: user.auth0Id,
  });

  const [bookings, beds] = await Promise.all([
    withRLS.booking.findMany({
      where: {
        propertyId,
        startDate: { lt: endDate },
        endDate: { gt: startDate },
      },
      select: {
        id: true,
        status: true,
        totalPrice: true,
        startDate: true,
        endDate: true,
        paymentMode: true,
        paymentStatus: true,
        refunds: { select: { amount: true, status: true } },
        payments: { select: { amount: true, status: true } },
        roomTemplateId: true,
        invoiceId: true,
        invoice: {
          select: {
            status: true,
          },
        },
        guest: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phoneNo: true,
            avatar: true,
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
            roomTemplateId: true,
          },
        },
        property: {
          select: {
            id: true,
            title: true,
            address: true,
            city: true,
            state: true,
            images: true,
          },
        },
      },
      orderBy: { startDate: "asc" },
    }),

    withRLS.bed.findMany({
      where: {
        room: {
          propertyId,
        },
      },
      select: {
        id: true,
        bedNo: true,
        room: {
          select: {
            id: true,
            title: true,
            roomTemplateId: true,
          },
        },
      },
      orderBy: [{ room: { title: "asc" } }, { bedNo: "asc" }],
    }),
  ]);

  const bookingsWithRefunds = bookings.map((booking) => ({
    ...booking,
    refundSummary: summarizeRefunds(booking.payments, booking.refunds),
  }));

  const payload = { bookings: bookingsWithRefunds, beds, startDate, endDate };

  await client.set(cacheKey, JSON.stringify(payload), "EX", 300);

  return res
    .status(200)
    .json(new ApiResponse(payload, "Occupancy fetched successfully", 200));
});

export const updateBookingStatus = asyncHandler(async (req, res) => {
  const { propertyId } = req.params as { propertyId: string };
  const { bookingId, action } = req.body as {
    bookingId: string;
    action: "APPROVE" | "REJECT";
  };

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

  if (user.id !== property.adminId) {
    throw new ApiError("You are not allowed to take this action", 403);
  }

  const withRLS = getSecuredClient({
    userId: user.id,
    tenantId: tenant.id,
    role: user.role,
    auth0Id: user.auth0Id,
  });

  const booking = await withRLS.booking.findUnique({
    where: {
      id: bookingId,
    },
    select: {
      id: true,
      propertyId: true,
      status: true,
      guestId: true,
      guest: {
        select: { auth0Id: true },
      },
    },
  });

  if (!booking || booking.propertyId !== propertyId) {
    throw new ApiError("No booking found", 404);
  }

  assertRejectable(booking.status);

  const newStatus = action === "APPROVE" ? "CONFIRMED" : "REJECTED";

  await withRLS.booking.update({
    where: {
      id: bookingId,
    },
    data: {
      status: newStatus,
    },
  });

  await client.del(`AdminBookings:${propertyId}`);
  await deleteOccupancyCache(propertyId);

  // Invoices are generated when the admin approves the booking — for both
  // payment modes. Rejection never produces an invoice.
  if (action === "APPROVE") {
    try {
      await rabbitmq({
        msg: JSON.stringify({
          bookingId: booking.id,
          userId: booking.guestId,
          auth0Id: booking.guest.auth0Id ?? "",
          tenantId: tenant.id,
        }),
        exchange: "tribel.events",
        routingKey: "invoice",
      });
    } catch (err) {
      console.error("Failed to emit invoice event for booking", booking.id, err);
    }
  }

  return res.status(200).json(
    new ApiResponse(
      { bookingId, status: newStatus },
      action === "APPROVE"
        ? "Booking approved successfully"
        : "Booking rejected successfully",
      200,
    ),
  );
});

export const markAdminPaymentPaid = asyncHandler(async (req, res) => {
  const { propertyId } = req.params as { propertyId: string };
  const { bookingId, provider, reference } = req.body as {
    bookingId: string;
    provider?: PaymentProvider;
    reference?: string;
  };

  if (!bookingId) throw new ApiError("Booking ID is required", 400);

  const securedDB = getSecuredClient({
    userId: req.user.id,
    tenantId: "",
    role: "",
    auth0Id: req.oidc.user?.sub,
  });

  const [user, property] = await Promise.all([
    securedDB.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, tenant: true, role: true, auth0Id: true },
    }),
    prisma.property.findUnique({ where: { id: propertyId } }),
  ]);

  if (!user || !property)
    throw new ApiError("No user and property found with this ID", 404);

  if (!user.tenant) throw new ApiError("Tenant not found", 404);
  if (user.id !== property.adminId)
    throw new ApiError("You are not allowed to take this action", 403);

  const withRLS = getSecuredClient({
    userId: user.id,
    tenantId: user.tenant.id,
    role: user.role,
    auth0Id: user.auth0Id,
  });

  const booking = await withRLS.booking.findUnique({
    where: { id: bookingId, propertyId: propertyId },
    select: {
      id: true,
      guestId: true,
      totalPrice: true,
      paymentMode: true,
      paymentStatus: true,
      status: true,
    },
  });

  if (!booking) throw new ApiError("No booking found", 404);

  assertMarkPaidAllowed(booking);

  const paymentProvider: PaymentProvider =
    provider && ["CASH", "UPI", "BANK_TRANSFER"].includes(provider)
      ? provider
      : "CASH";

  const [, updatedBooking] = await withRLS.$transaction([
    withRLS.payment.create({
      data: {
        bookingId: booking.id,
        guestId: booking.guestId,
        provider: paymentProvider,
        status: "PAID",
        amount: booking.totalPrice,
        offlineReference: reference ?? null,
        verifiedById: user.id,
        verifiedAt: new Date(),
        paidAt: new Date(),
      },
    }),
    withRLS.booking.update({
      where: { id: booking.id },
      data: { paymentStatus: "PAID" },
    }),
  ]);

  await client.del(`AdminBookings:${propertyId}`);
  await deleteOccupancyCache(propertyId);

  return res
    .status(200)
    .json(
      new ApiResponse(
        { bookingId: updatedBooking.id, paymentStatus: "PAID" },
        "Payment marked as paid successfully",
        200,
      ),
    );
});

export const recordAdminPaymentRefund = asyncHandler(async (req, res) => {
  const { propertyId } = req.params as { propertyId: string };
  const { bookingId, amount, method, reference } = req.body as {
    bookingId: string;
    amount?: number;
    method?: PaymentProvider;
    reference?: string;
  };

  if (!bookingId) throw new ApiError("Booking ID is required", 400);

  const securedDB = getSecuredClient({
    userId: req.user.id,
    tenantId: "",
    role: "",
    auth0Id: req.oidc.user?.sub,
  });

  const [user, property] = await Promise.all([
    securedDB.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, tenant: true, role: true, auth0Id: true },
    }),
    prisma.property.findUnique({ where: { id: propertyId } }),
  ]);

  if (!user || !property)
    throw new ApiError("No user and property found with this ID", 404);

  if (!user.tenant) throw new ApiError("Tenant not found", 404);
  if (user.id !== property.adminId)
    throw new ApiError("You are not allowed to take this action", 403);

  const tenantId = user.tenant.id;

  const withRLS = getSecuredClient({
    userId: user.id,
    tenantId,
    role: user.role,
    auth0Id: user.auth0Id,
  });

  const booking = await withRLS.booking.findUnique({
    where: { id: bookingId, propertyId: propertyId },
    select: {
      id: true,
      paymentMode: true,
      paymentStatus: true,
    },
  });

  if (!booking) throw new ApiError("No booking found", 404);

  assertRefundAllowed(booking.paymentStatus);

  // Online refunds are gateway-mandated: the refund id comes from Razorpay,
  // never from the admin's keyboard.
  if (booking.paymentMode === "ONLINE" && method && method !== "RAZORPAY") {
    throw new ApiError(
      "Online refunds are processed through Razorpay and cannot use another method",
      400,
    );
  }

  const refundMethod = resolveRefundMethod(booking.paymentMode, method);

  const outcome = await prisma.$transaction(
    async (tx) => {
      // The lock/read/insert below must share one connection for the cap to
      // hold, so this runs on the plain client with an explicit RLS context
      // (Payment and Refund carry no policy, Booking is read outside).
      await tx.$executeRaw`
        SELECT set_config('app.current_role', ${user.role}::text, true),
          set_config('app.current_tenant_id', ${tenantId}::text, true),
          set_config('app.current_userId', ${user.id}::text, true),
          set_config('app.current_user_auth0_id', ${user.auth0Id}::text, true)
      `;

      // Resolve the payment once: the cumulative cap, the ledger row and the
      // gateway call must all be backed by the same payment. Looking it up
      // again inside the gateway service is how the ledger could end up
      // pointing at one payment while another was refunded.
      const payment = await tx.payment.findFirst({
        where:
          booking.paymentMode === "ONLINE"
            ? {
                bookingId: booking.id,
                provider: "RAZORPAY",
                status: "PAID",
                razorpayPaymentId: { not: null },
              }
            : { bookingId: booking.id, status: "PAID" },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          amount: true,
          status: true,
          razorpayPaymentId: true,
          paidAt: true,
          createdAt: true,
        },
      });

      if (!payment)
        throw new ApiError("No paid payment found for this booking", 404);

      // Serialize refunds on this payment. The cap is a read-then-write, so
      // without the row lock two concurrent requests each read the same balance
      // and both refund it. Payment has no RLS policy, so a plain row lock is
      // enough to make the check hold.
      await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${payment.id} FOR UPDATE`;

      const refunds = await tx.refund.findMany({
        where: { paymentId: payment.id },
        select: { amount: true, status: true },
      });

      assertNoRefundInFlight(refunds);

      // Default to whatever is still refundable, and cap cumulatively against
      // the captured amount — never against the booking total, which a partially
      // paid booking would let an admin refund beyond what was actually
      // collected.
      const resolvedAmount =
        amount ?? refundableBalance(payment.amount, refunds);

      assertRefundWithinPaid(payment.amount, refunds, resolvedAmount);

      if (booking.paymentMode === "ONLINE") {
        if (!payment.razorpayPaymentId) {
          throw new ApiError(
            "The captured payment has no Razorpay payment id — record this refund offline instead",
            400,
          );
        }

        // Razorpay refuses refunds on payments older than six months; fail with
        // an actionable message instead of a raw gateway error. The ledger row
        // stays PENDING until the refund.processed webhook (or the
        // reconciliation sweep) confirms the money actually moved.
        assertRefundWindowOpen(payment.paidAt ?? payment.createdAt);

        const gatewayRefund = await initiateGatewayRefund(
          payment.razorpayPaymentId,
          resolvedAmount,
          booking.id,
        );

        const refund = await tx.refund.create({
          data: {
            paymentId: payment.id,
            bookingId: booking.id,
            amount: resolvedAmount,
            method: "RAZORPAY",
            providerRefundId: gatewayRefund.refundId,
            status: "PENDING",
            createdById: user.id,
          },
        });

        return {
          refund,
          payment,
          refunds,
          resolvedAmount,
          gatewayRefundId: gatewayRefund.refundId,
        };
      }

      const refund = await tx.refund.create({
        data: {
          paymentId: payment.id,
          bookingId: booking.id,
          amount: resolvedAmount,
          method: refundMethod,
          reference: reference ?? null,
          status: "PROCESSED",
          processedAt: new Date(),
          createdById: user.id,
        },
      });

      return { refund, payment, refunds, resolvedAmount, gatewayRefundId: null };
    },
    { maxWait: 10000, timeout: 20000 },
  );

  const refundSummary = summarizeRefunds(
    [outcome.payment],
    [
      ...outcome.refunds,
      { amount: outcome.resolvedAmount, status: outcome.refund.status },
    ],
  );

  await client.del(`AdminBookings:${propertyId}`);
  await deleteOccupancyCache(propertyId);

  return res.status(200).json(
    new ApiResponse(
      {
        bookingId: booking.id,
        refundId: outcome.refund.id,
        refundStatus: outcome.refund.status,
        refundAmount: outcome.resolvedAmount,
        refundMethod: outcome.refund.method,
        providerRefundId: outcome.gatewayRefundId,
        refundedAmount: refundSummary.refundedAmount,
        refundState: refundSummary.refundState,
        refundSummary,
      },
      booking.paymentMode === "ONLINE"
        ? "Refund initiated via Razorpay — the booking updates when the refund is processed"
        : refundSummary.refundState === "FULL"
          ? "Payment refunded successfully"
          : "Partial refund recorded successfully",
      200,
    ),
  );
});

/**
 * Admin assigns a specific bed to a booking that only carries a room
 * template. The bed row is locked for the transaction so two admins cannot
 * assign the same bed concurrently; the exclusion constraint remains the
 * final word on overlapping ranges.
 */
export const assignBookingBed = asyncHandler(async (req, res) => {
  const { propertyId } = req.params as { propertyId: string };
  const { bookingId, bedId } = req.body as {
    bookingId: string;
    bedId: string;
  };

  if (!bookingId || !bedId)
    throw new ApiError("Booking ID and Bed ID are required", 400);

  const securedDB = getSecuredClient({
    userId: req.user.id,
    tenantId: "",
    role: "",
    auth0Id: req.oidc.user?.sub,
  });

  const [user, property] = await Promise.all([
    securedDB.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, tenant: true, role: true, auth0Id: true },
    }),
    prisma.property.findUnique({ where: { id: propertyId } }),
  ]);

  if (!user || !property)
    throw new ApiError("No user and property found with this ID", 404);

  if (!user.tenant) throw new ApiError("Tenant not found", 404);
  if (user.id !== property.adminId)
    throw new ApiError("You are not allowed to take this action", 403);

  const withRLS = getSecuredClient({
    userId: user.id,
    tenantId: user.tenant.id,
    role: user.role,
    auth0Id: user.auth0Id,
  });

  const result = await withRLS.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: bookingId, propertyId },
      select: {
        id: true,
        status: true,
        roomTemplateId: true,
        startDate: true,
        endDate: true,
      },
    });

    if (!booking) throw new ApiError("No booking found", 404);

    const bed = await tx.bed.findUnique({
      where: { id: bedId },
      select: {
        id: true,
        deletedAt: true,
        roomId: true,
        room: { select: { roomTemplateId: true } },
      },
    });

    if (!bed) throw new ApiError("No bed found", 404);

    const overlappingActiveBookings = await tx.booking.count({
      where: {
        bedId,
        id: { not: booking.id },
        status: { in: ["PENDING", "CONFIRMED", "ONGOING"] },
        startDate: { lt: booking.endDate },
        endDate: { gt: booking.startDate },
      },
    });

    assertBedAssignable(
      booking,
      { roomTemplateId: bed.room.roomTemplateId, deletedAt: bed.deletedAt },
      overlappingActiveBookings,
    );

    const updatedBooking = await tx.booking.update({
      where: { id: booking.id },
      data: { bedId: bed.id, roomId: bed.roomId },
      select: {
        id: true,
        bedId: true,
        roomId: true,
        bed: { select: { bedNo: true, room: { select: { title: true } } } },
      },
    });

    return updatedBooking;
  });

  await client.del(`AdminBookings:${propertyId}`);
  await deleteOccupancyCache(propertyId);

  return res
    .status(200)
    .json(
      new ApiResponse(
        result,
        `Bed assigned: ${result.bed?.room.title ?? "Room"} · Bed ${result.bed?.bedNo ?? ""}`,
        200,
      ),
    );
});

/**
 * The transaction client handed to `$transaction` callbacks by the RLS
 * extended Prisma client (guest/user scoped). Args stay loose because the
 * extension generics differ from the stock TransactionClient.
 *
 * Date changes re-check availability and re-price the booking. Guests may
 * reschedule strictly before arrival; admins may reschedule any non-terminal
 * booking, including mid-stay (ONGOING) ones, keeping the same bed.
 */
type BookingDateChangeTx = Parameters<
  Parameters<ReturnType<typeof getSecuredClient>["$transaction"]>[0]
>[0];

async function applyBookingDateChange(
  tx: BookingDateChangeTx,
  bookingId: string,
  actor: "GUEST" | "ADMIN",
  newStartDate: Date,
  newEndDate: Date,
) {
  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      status: true,
      startDate: true,
      endDate: true,
      bedId: true,
      roomTemplateId: true,
      roomTemplate: { select: { pricePerBed: true } },
    },
  });

  if (!booking) throw new ApiError("No booking found", 404);

  assertDateChangeAllowed(booking, actor, newStartDate, newEndDate);

  let overlapCount: number;

  if (booking.bedId) {
    overlapCount = await tx.booking.count({
      where: {
        bedId: booking.bedId,
        id: { not: booking.id },
        status: { in: ["PENDING", "CONFIRMED", "ONGOING"] },
        startDate: { lt: newEndDate },
        endDate: { gt: newStartDate },
      },
    });
  } else {
    const bedRows = await tx.bed.findMany({
      where: {
        deletedAt: null,
        room: { roomTemplateId: booking.roomTemplateId },
      },
      select: { id: true },
    });
    overlapCount = await tx.booking.count({
      where: {
        roomTemplateId: booking.roomTemplateId,
        id: { not: booking.id },
        status: { in: ["PENDING", "CONFIRMED", "ONGOING"] },
        startDate: { lt: newEndDate },
        endDate: { gt: newStartDate },
      },
    });
    if (overlapCount >= bedRows.length) {
      throw new ApiError(
        "This room type is sold out for the new dates",
        400,
      );
    }
  }

  if (booking.bedId && overlapCount > 0) {
    throw new ApiError(
      "The bed is already booked for part of the new date range",
      409,
    );
  }

  const price = computeBookingPrice(
    booking.roomTemplate.pricePerBed,
    newStartDate,
    newEndDate,
  );

  const updatedBooking = await tx.booking.update({
    where: { id: booking.id },
    data: {
      startDate: newStartDate,
      endDate: newEndDate,
      totalPrice: price.total,
    },
  });

  return { updatedBooking, price };
}

export const updateGuestBookingDates = asyncHandler(async (req, res) => {
  const { bookingId, startDate, endDate } = req.body as {
    bookingId: string;
    startDate: Date;
    endDate: Date;
  };

  if (!bookingId || !startDate || !endDate)
    throw new ApiError("Booking ID, check-in and check-out are required", 400);

  const newStartDate = new Date(startDate);
  const newEndDate = new Date(endDate);

  const securedDB = getSecuredClient({
    userId: req.user.id,
    tenantId: "",
    role: "",
    auth0Id: req.oidc.user?.sub,
  });

  const ownedBooking = await securedDB.booking.findUnique({
    where: { id: bookingId },
    select: { guestId: true, propertyId: true },
  });

  if (!ownedBooking) throw new ApiError("No booking found with this ID", 404);
  if (ownedBooking.guestId !== req.user.id)
    throw new ApiError("Forbidden", 403);

  const result = await securedDB.$transaction(async (tx) =>
    applyBookingDateChange(tx, bookingId, "GUEST", newStartDate, newEndDate),
  );

  await client.del(`AdminBookings:${ownedBooking.propertyId}`);
  await deleteOccupancyCache(ownedBooking.propertyId);

  return res
    .status(200)
    .json(
      new ApiResponse(
        {
          bookingId: result.updatedBooking.id,
          startDate: result.updatedBooking.startDate,
          endDate: result.updatedBooking.endDate,
          totalPrice: result.updatedBooking.totalPrice,
          price: result.price,
        },
        "Booking dates updated successfully",
        200,
      ),
    );
});

export const updateAdminBookingDates = asyncHandler(async (req, res) => {
  const { propertyId } = req.params as { propertyId: string };
  const { bookingId, startDate, endDate } = req.body as {
    bookingId: string;
    startDate: Date;
    endDate: Date;
  };

  if (!bookingId || !startDate || !endDate)
    throw new ApiError("Booking ID, check-in and check-out are required", 400);

  const newStartDate = new Date(startDate);
  const newEndDate = new Date(endDate);

  const securedDB = getSecuredClient({
    userId: req.user.id,
    tenantId: "",
    role: "",
    auth0Id: req.oidc.user?.sub,
  });

  const [user, property] = await Promise.all([
    securedDB.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, tenant: true, role: true, auth0Id: true },
    }),
    prisma.property.findUnique({ where: { id: propertyId } }),
  ]);

  if (!user || !property)
    throw new ApiError("No user and property found with this ID", 404);

  if (!user.tenant) throw new ApiError("Tenant not found", 404);
  if (user.id !== property.adminId)
    throw new ApiError("You are not allowed to take this action", 403);

  const withRLS = getSecuredClient({
    userId: user.id,
    tenantId: user.tenant.id,
    role: user.role,
    auth0Id: user.auth0Id,
  });

  const result = await withRLS.$transaction(async (tx) =>
    applyBookingDateChange(tx, bookingId, "ADMIN", newStartDate, newEndDate),
  );

  await client.del(`AdminBookings:${propertyId}`);
  await deleteOccupancyCache(propertyId);

  return res
    .status(200)
    .json(
      new ApiResponse(
        {
          bookingId: result.updatedBooking.id,
          startDate: result.updatedBooking.startDate,
          endDate: result.updatedBooking.endDate,
          totalPrice: result.updatedBooking.totalPrice,
          price: result.price,
        },
        "Booking dates updated successfully",
        200,
      ),
    );
});
