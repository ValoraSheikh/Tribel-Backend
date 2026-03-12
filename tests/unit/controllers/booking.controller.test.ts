import { describe, test, expect, beforeEach, vi } from "vitest";
import {
  createBooking,
  cancelBooking,
  cancelAdminBooking,
  getUserBookings,
  getBookingsForAdmin,
  updateUserBooking,
  getAllBooking,
  getBookingDetails,
} from "../../../src/controller/booking.controller";
import { getSecuredClient } from "../../../src/lib/prisma/prisma-rls";
import prisma from "../../../src/lib/prisma/db";
import { ApiError } from "../../../src/lib";
import { acquireLock, releaseLock } from "../../../src/lib/redis/redis-lock";

vi.mock("uuid", () => ({
  v4: vi.fn(() => "mocked-uuid"),
}));

vi.mock("../../../src/lib/redis/redis-lock.ts", () => ({
  acquireLock: vi.fn(),
  releaseLock: vi.fn(),
}));

vi.mock("../../../src/lib/index.ts", async () => {
  const original = await vi.importActual<any>("../../../src/lib/index.ts");
  return {
    ...original,
    asyncHandler: (fn: any) => (req: any, res: any, next: any) => {
      return Promise.resolve(fn(req, res, next)).catch(next);
    },
  };
});

vi.mock("../../../src/lib/prisma/db.ts", () => ({
  __esModule: true,
  default: {
    idempotencyKey: { findUnique: vi.fn(), create: vi.fn() },
    booking: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    bed: { update: vi.fn() },
    property: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("../../../src/lib/prisma/prisma-rls.ts", () => ({
  getSecuredClient: vi.fn(),
}));

describe("Booking Controller", () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: any;
  let mockSecuredDb: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockSecuredDb = {
      user: { findUnique: vi.fn() },
      booking: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
      },
    };

    (getSecuredClient as any).mockReturnValue(mockSecuredDb);

    mockReq = {
      user: { id: "user-123" },
      oidc: { user: { sub: "auth0|123" } },
      body: {},
      params: {},
      query: {},
      get: vi.fn(),
      originalUrl: "/api/bookings",
      method: "POST",
    };

    mockRes = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    };

    mockNext = vi.fn();
  });

  // TEST: create booking
  describe("createBooking", () => {
    test("should successfully create a booking", async () => {
      const futureStart = new Date(Date.now() + 86400000);
      const futureEnd = new Date(Date.now() + 172800000);

      mockReq.get.mockReturnValue("idemp-key-123");
      mockReq.body = {
        propertyId: "prop-1",
        roomTemplateId: "rt-1",
        startDate: futureStart,
        endDate: futureEnd,
      };

      (prisma.idempotencyKey.findUnique as any).mockResolvedValue(null);
      (acquireLock as any).mockResolvedValue(true);

      (prisma.$transaction as any).mockImplementation(async (callback: any) => {
        const mockTx = {
          $executeRaw: vi.fn().mockResolvedValue([]),
          $queryRaw: vi
            .fn()
            .mockResolvedValue([
              { id: "bed-1", roomId: "room-1", pricePerBed: 100 },
            ]),
          booking: { create: vi.fn().mockResolvedValue({ id: "booking-1" }) },
          bed: { update: vi.fn() },
          idempotencyKey: { create: vi.fn() },
        };
        return callback(mockTx);
      });

      await createBooking(mockReq, mockRes, mockNext);

      expect(acquireLock).toHaveBeenCalled();

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(releaseLock).toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(201);
    });

    test("should throw 400 if idempotency key is missing", async () => {
      mockReq.get.mockReturnValue(undefined);

      await createBooking(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(400);
    });

    test("should return existing response if idempotency key exists", async () => {
      mockReq.get.mockReturnValue("idemp-key-123");
      (prisma.idempotencyKey.findUnique as any).mockResolvedValue({
        userId: "user-123",
        responseStatus: 201,
        reponsesBody: { id: "booking-1" },
      });

      await createBooking(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith({ id: "booking-1" });
    });
  });

  // TEST: cancel booking
  describe("cancelBooking", () => {
    test("should successfully cancel a booking", async () => {
      mockReq.body = { bookingId: "booking-1" };

      const futureDate = new Date(Date.now() + 86400000);
      mockSecuredDb.booking.findUnique.mockResolvedValue({
        id: "booking-1",
        startDate: futureDate,
        cancelledAt: null,
        guestId: "user-123",
        bedId: "bed-1",
      });

      (prisma.booking.update as any).mockResolvedValue({
        id: "booking-1",
        status: "CANCELLED",
      });

      await cancelBooking(mockReq, mockRes, mockNext);

      expect(prisma.booking.update).toHaveBeenCalled();
      expect(prisma.bed.update).toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    test("should throw 400 if booking is already started", async () => {
      mockReq.body = { bookingId: "booking-1" };
      const pastDate = new Date(Date.now() - 86400000);

      mockSecuredDb.booking.findUnique.mockResolvedValue({
        id: "booking-1",
        startDate: pastDate,
      });

      await cancelBooking(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(400);
    });
  });

  // TEST: cancel admin booking
  describe("cancelAdminBooking", () => {
    test("should successfully cancel a booking by admin", async () => {
      mockReq.params = { propertyId: "prop-1" };
      mockReq.body = { bookingId: "booking-1" };

      mockSecuredDb.user.findUnique.mockResolvedValue({
        id: "user-123",
        tenant: { id: "tenant-99" },
      });

      (prisma.property.findUnique as any).mockResolvedValue({
        id: "prop-1",
        adminId: "user-123",
      });

      mockSecuredDb.booking.update.mockResolvedValue({ id: "booking-1" });

      await cancelAdminBooking(mockReq, mockRes, mockNext);

      expect(mockSecuredDb.booking.update).toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    test("should throw 403 if user is not property admin", async () => {
      mockReq.params = { propertyId: "prop-1" };
      mockReq.body = { bookingId: "booking-1" };

      mockSecuredDb.user.findUnique.mockResolvedValue({
        id: "user-123",
        tenant: { id: "tenant-99" },
      });

      (prisma.property.findUnique as any).mockResolvedValue({
        id: "prop-1",
        adminId: "user-DIFFERENT",
      });

      await cancelAdminBooking(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(403);
    });
  });

  // TEST: get user booking
  describe("getUserBookings", () => {
    test("should successfully fetch user bookings", async () => {
      mockReq.query = { page: "1", limit: "10" };

      mockSecuredDb.booking.findMany.mockResolvedValue([{ id: "booking-1" }]);
      mockSecuredDb.booking.count.mockResolvedValue(1);

      await getUserBookings(mockReq, mockRes, mockNext);

      expect(mockSecuredDb.booking.findMany).toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    test("should return 404 if no bookings found", async () => {
      mockSecuredDb.booking.findMany.mockResolvedValue(null);
      mockSecuredDb.booking.count.mockResolvedValue(0);

      await getUserBookings(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
    });
  });

  // TEST: get admin booking
  describe("getBookingsForAdmin", () => {
    test("should successfully fetch bookings for admin", async () => {
      mockReq.params = { propertyId: "prop-1" };

      mockSecuredDb.user.findUnique.mockResolvedValue({
        id: "user-123",
        tenant: { id: "tenant-99" },
      });

      (prisma.property.findUnique as any).mockResolvedValue({
        id: "prop-1",
        adminId: "user-123",
      });

      mockSecuredDb.booking.findMany.mockResolvedValue([{ id: "booking-1" }]);
      mockSecuredDb.booking.count.mockResolvedValue(1);

      await getBookingsForAdmin(mockReq, mockRes, mockNext);

      expect(mockSecuredDb.booking.findMany).toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    test("should throw 403 if user is not property admin", async () => {
      mockReq.params = { propertyId: "prop-1" };

      mockSecuredDb.user.findUnique.mockResolvedValue({
        id: "user-123",
        tenant: { id: "tenant-99" },
      });

      (prisma.property.findUnique as any).mockResolvedValue({
        id: "prop-1",
        adminId: "user-DIFFERENT",
      });

      await getBookingsForAdmin(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(403);
    });
  });

  // TEST: update user booking
  describe("updateUserBooking", () => {
    test("should successfully update a booking", async () => {
      const startDate = new Date();
      const endDate = new Date(Date.now() + 86400000);

      mockReq.params = { bookingId: "booking-1" };
      mockReq.body = { startDate, endDate };

      (prisma.booking.findUnique as any).mockResolvedValue({
        id: "booking-1",
        guestId: "user-123",
        bedId: "bed-1",
      });

      (prisma.booking.findMany as any).mockResolvedValue([]);

      mockSecuredDb.booking.update.mockResolvedValue({ id: "booking-1" });

      await updateUserBooking(mockReq, mockRes, mockNext);

      expect(mockSecuredDb.booking.update).toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    test("should throw 400 if dates conflict", async () => {
      const startDate = new Date();
      const endDate = new Date(Date.now() + 86400000);

      mockReq.params = { bookingId: "booking-1" };
      mockReq.body = { startDate, endDate };

      (prisma.booking.findUnique as any).mockResolvedValue({
        id: "booking-1",
        guestId: "user-123",
        bedId: "bed-1",
      });

      (prisma.booking.findMany as any).mockResolvedValue([
        { id: "conflict-booking" },
      ]);

      await updateUserBooking(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(400);
    });
  });

  // TEST: get all booking
  describe("getAllBooking", () => {
    test("should successfully fetch all bookings for Super_Admin", async () => {
      mockSecuredDb.user.findUnique.mockResolvedValue({
        id: "user-123",
        role: "Super_Admin",
      });

      mockSecuredDb.booking.findMany.mockResolvedValue([{ id: "booking-1" }]);
      mockSecuredDb.booking.count.mockResolvedValue(1);

      await getAllBooking(mockReq, mockRes, mockNext);

      expect(mockSecuredDb.booking.findMany).toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    test("should throw 403 if user is not Super_Admin", async () => {
      mockSecuredDb.user.findUnique.mockResolvedValue({
        id: "user-123",
        role: "Admin",
      });

      await getAllBooking(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(403);
    });
  });

  // TEST: get booking details booking
  describe("getBookingDetails", () => {
    test("should successfully fetch booking details", async () => {
      mockReq.body = { bookingId: "booking-1" };

      mockSecuredDb.user.findUnique.mockResolvedValue({
        id: "user-123",
        tenant: { id: "tenant-99" },
      });

      mockSecuredDb.booking.findUnique.mockResolvedValue({
        id: "booking-1",
      });

      await getBookingDetails(mockReq, mockRes, mockNext);

      expect(mockSecuredDb.booking.findUnique).toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    test("should throw 404 if booking not found", async () => {
      mockReq.body = { bookingId: "booking-1" };

      mockSecuredDb.user.findUnique.mockResolvedValue({
        id: "user-123",
        tenant: { id: "tenant-99" },
      });

      mockSecuredDb.booking.findUnique.mockResolvedValue(null);

      await getBookingDetails(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(404);
    });
  });
});
