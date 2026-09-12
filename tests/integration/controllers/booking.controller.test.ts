import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createBooking,
  cancelBooking,
  cancelAdminBooking,
  getUserBookings,
  getBookingsForAdmin,
  updateUserBooking,
  getAllBooking,
  getBookingDetails,
  getOccupancy,
  updateBookingStatus,
} from "../../../src/controller/booking.controller.ts";
import testDB, { resetTestDatabase } from "../../setup.ts";
import { v4 as uuidv4 } from "uuid";

vi.mock("../../../src/lib/redis/redis-lock.ts", () => ({
  acquireLock: vi.fn().mockResolvedValue(true),
  releaseLock: vi.fn().mockResolvedValue(true),
}));

describe("Integration: Booking Controller Suite", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const mockNext = vi.fn();

  const setupMockHttp = (
    reqUser?: any,
    reqBody?: any,
    reqQuery?: any,
    reqParams?: any,
    oidcUserPayload?: any,
    headers?: Record<string, string>
  ) => {
    const req: any = {
      user: reqUser || {},
      body: reqBody || {},
      query: reqQuery || {},
      params: reqParams || {},
      oidc: {
        user: oidcUserPayload || { sub: "auth0|test" },
      },
      get: vi.fn((name: string) => headers?.[name]),
      originalUrl: "/api/bookings",
      method: "POST",
    };

    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    return { req, res };
  };

  const executeControllerAndWait = (
    controllerFn: (...args: unknown[]) => unknown,
    req: any,
    res: any,
    next: any
  ) => {
    return new Promise((resolve, reject) => {
      res.json.mockImplementation((data: any) => resolve(data));
      next.mockImplementation((err: any) => reject(err || new Error("next() called without error")));
      controllerFn(req, res, next);
    });
  };

  const seedEnvironment = async () => {
    const admin = await testDB.user.create({
      data: {
        auth0Id: `auth0|admin_${uuidv4()}`,
        email: "admin@test.com",
        firstName: "Admin",
        role: "Admin",
        tenant: { create: { name: "Tenant 1", slug: `t1_${uuidv4()}` } },
      },
      include: { tenant: true },
    });

    const guest = await testDB.user.create({
      data: {
        auth0Id: `auth0|guest_${uuidv4()}`,
        email: "guest@test.com",
        firstName: "Guest",
        role: "Guest",
      },
    });

    const property = await testDB.property.create({
      data: {
        title: "Test Property",
        type: "Hostel",
        adminId: admin.id,
        tenantId: admin.tenant!.id,
        address: "123 St",
        city: "City",
        state: "State",
        country: "Country",
        postal_code: "12345",
        contact_email: "test@prop.com",
        contact_phone: "1234567890",
        latitude: 12.34,
        longitude: 56.78,
      },
    });

    const template = await testDB.roomTemplate.create({
      data: {
        title: "Standard Dorm",
        bedsPerRoom: 2,
        numberOfRooms: 1,
        pricePerBed: 100,
        type: "Dormitory",
        image: "img.jpg",
        propertyId: property.id,
      },
    });

    const room = await testDB.room.create({
      data: {
        title: "Room 1",
        bedCount: 2,
        pricePerBed: 100,
        propertyId: property.id,
        roomTemplateId: template.id,
      },
    });

    const bed = await testDB.bed.create({
      data: {
        roomId: room.id,
        bedNo: 1,
      },
    });

    return { admin, guest, property, template, room, bed };
  };

  describe("createBooking", () => {
    it("should throw 400 if Idempotency key is missing", async () => {
      const { req, res } = setupMockHttp();
      try {
        await executeControllerAndWait(createBooking, req, res, mockNext);
      } catch (error: any) {
        expect(error.statusCode).toBe(400);
        expect(error.message).toBe("Idempotency key is missing");
      }
    });

    it("should successfully create a booking and mark bed as taken", async () => {
      const { guest, property, template, bed } = await seedEnvironment();
      
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const nextWeek = new Date();
      nextWeek.setDate(nextWeek.getDate() + 7);

      const { req, res } = setupMockHttp(
        { id: guest.id },
        { propertyId: property.id, roomTemplateId: template.id, startDate: tomorrow, endDate: nextWeek, paymentMode: "ONLINE" },
        {},
        {},
        { sub: guest.auth0Id },
        { "Idempotency-key": uuidv4() }
      );

      await executeControllerAndWait(createBooking, req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(201);
      const payload = res.json.mock.calls[0][0];
      expect(payload.data.booking.bedId).toBe(bed.id);

      const updatedBed = await testDB.bed.findUnique({ where: { id: bed.id } });
      expect(updatedBed?.userId).toBe(guest.id);
    });
  });

  describe("cancelBooking", () => {
    it("should cancel a booking successfully and free the bed", async () => {
      const { guest, property, room, bed } = await seedEnvironment();

      const futureStart = new Date();
      futureStart.setDate(futureStart.getDate() + 5);
      const futureEnd = new Date();
      futureEnd.setDate(futureEnd.getDate() + 10);

      const booking = await testDB.booking.create({
        data: {
          propertyId: property.id,
          roomId: room.id,
          bedId: bed.id,
          guestId: guest.id,
          totalPrice: 500,
          startDate: futureStart,
          endDate: futureEnd,
          status: "CONFIRMED",
          paymentStatus: "PENDING",
          paymentMode: "ONLINE",
        },
      });

      const { req, res } = setupMockHttp({ id: guest.id }, { bookingId: booking.id }, {}, {}, { sub: guest.auth0Id });

      await executeControllerAndWait(cancelBooking, req, res, mockNext);

      const payload = res.json.mock.calls[0][0];
      expect(payload.data.status).toBe("CANCELLED");

      const freedBed = await testDB.bed.findUnique({ where: { id: bed.id } });
      expect(freedBed?.userId).toBeNull();
    });

    it("should throw 400 if trying to cancel past or ongoing booking", async () => {
      const { guest, property, room, bed } = await seedEnvironment();

      const pastStart = new Date();
      pastStart.setDate(pastStart.getDate() - 2);
      const futureEnd = new Date();
      futureEnd.setDate(futureEnd.getDate() + 2);

      const booking = await testDB.booking.create({
        data: {
          propertyId: property.id,
          roomId: room.id,
          bedId: bed.id,
          guestId: guest.id,
          totalPrice: 500,
          startDate: pastStart,
          endDate: futureEnd,
          status: "CONFIRMED",
          paymentStatus: "PENDING",
          paymentMode: "ONLINE",
        },
      });

      const { req, res } = setupMockHttp({ id: guest.id }, { bookingId: booking.id }, {}, {}, { sub: guest.auth0Id });

      try {
        await executeControllerAndWait(cancelBooking, req, res, mockNext);
      } catch (error: any) {
        expect(error.statusCode).toBe(400);
        expect(error.message).toBe("Can't cancel past and ongoing booking");
      }
    });
  });

  describe("cancelAdminBooking", () => {
    it("should allow admin to cancel a booking in their property", async () => {
      const { admin, guest, property, room, bed } = await seedEnvironment();

      const booking = await testDB.booking.create({
        data: {
          propertyId: property.id,
          roomId: room.id,
          bedId: bed.id,
          guestId: guest.id,
          totalPrice: 500,
          startDate: new Date(),
          endDate: new Date(),
          status: "CONFIRMED",
          paymentStatus: "PENDING",
          paymentMode: "ONLINE",
        },
      });

      const { req, res } = setupMockHttp(
        { id: admin.id },
        { bookingId: booking.id },
        {},
        { propertyId: property.id },
        { sub: admin.auth0Id }
      );

      await executeControllerAndWait(cancelAdminBooking, req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(200);
      const updatedBooking = await testDB.booking.findUnique({ where: { id: booking.id } });
      expect(updatedBooking?.status).toBe("CANCELLED");
    });
  });

  describe("getUserBookings", () => {
    it("should return paginated bookings for the logged-in user", async () => {
      const { guest, property, room, bed } = await seedEnvironment();

      await testDB.booking.create({
        data: {
          propertyId: property.id,
          roomId: room.id,
          bedId: bed.id,
          guestId: guest.id,
          totalPrice: 100,
          startDate: new Date(),
          endDate: new Date(),
          status: "CONFIRMED",
          paymentStatus: "PENDING",
          paymentMode: "ONLINE",
        },
      });

      const { req, res } = setupMockHttp({ id: guest.id }, {}, { page: "1", limit: "10" }, {}, { sub: guest.auth0Id });

      await executeControllerAndWait(getUserBookings, req, res, mockNext);

      const payload = res.json.mock.calls[0][0];
      expect(payload.data.bookings.length).toBe(1);
      expect(payload.data.totalBookings).toBe(1);
    });
  });

  describe("getBookingsForAdmin", () => {
    it("should return property bookings for the admin", async () => {
      const { admin, guest, property, room, bed } = await seedEnvironment();

      await testDB.booking.create({
        data: {
          propertyId: property.id,
          roomId: room.id,
          bedId: bed.id,
          guestId: guest.id,
          totalPrice: 100,
          startDate: new Date(),
          endDate: new Date(),
          status: "CONFIRMED",
          paymentStatus: "PENDING",
          paymentMode: "ONLINE",
        },
      });

      const { req, res } = setupMockHttp(
        { id: admin.id },
        {},
        { page: "1", limit: "10" },
        { propertyId: property.id },
        { sub: admin.auth0Id }
      );

      await executeControllerAndWait(getBookingsForAdmin, req, res, mockNext);

      const payload = res.json.mock.calls[0][0];
      expect(payload.data.bookings.length).toBe(1);
    });
  });

  describe("updateUserBooking", () => {
    it("should update booking dates successfully", async () => {
      const { guest, property, room, bed } = await seedEnvironment();

      const start = new Date();
      const end = new Date();
      end.setDate(end.getDate() + 2);

      const booking = await testDB.booking.create({
        data: {
          propertyId: property.id,
          roomId: room.id,
          bedId: bed.id,
          guestId: guest.id,
          totalPrice: 100,
          startDate: start,
          endDate: end,
          status: "CONFIRMED",
          paymentStatus: "PENDING",
          paymentMode: "ONLINE",
        },
      });

      const newStart = new Date();
      newStart.setDate(newStart.getDate() + 5);
      const newEnd = new Date();
      newEnd.setDate(newEnd.getDate() + 10);

      const { req, res } = setupMockHttp(
        { id: guest.id },
        { startDate: newStart, endDate: newEnd },
        {},
        { bookingId: booking.id },
        { sub: guest.auth0Id }
      );

      await executeControllerAndWait(updateUserBooking, req, res, mockNext);

      const payload = res.json.mock.calls[0][0];
      expect(new Date(payload.data.startDate).getTime()).toBe(newStart.getTime());
    });
  });

  describe("getAllBooking", () => {
    it("should return all bookings for Super_Admin", async () => {
      const superAdmin = await testDB.user.create({
        data: {
          auth0Id: "auth0|super",
          email: "super@test.com",
          firstName: "Super",
          role: "Super_Admin",
        },
      });

      const { guest, property, room, bed } = await seedEnvironment();

      await testDB.booking.create({
        data: {
          propertyId: property.id,
          roomId: room.id,
          bedId: bed.id,
          guestId: guest.id,
          totalPrice: 100,
          startDate: new Date(),
          endDate: new Date(),
          status: "CONFIRMED",
          paymentStatus: "PENDING",
          paymentMode: "ONLINE",
        },
      });

      const { req, res } = setupMockHttp(
        { id: superAdmin.id },
        {},
        { page: "1", limit: "10" },
        {},
        { sub: superAdmin.auth0Id }
      );

      await executeControllerAndWait(getAllBooking, req, res, mockNext);

      const payload = res.json.mock.calls[0][0];
      expect(payload.data.totalBookings).toBeGreaterThanOrEqual(1);
    });
  });

  describe("getBookingDetails", () => {
    it("should return specific booking details", async () => {
      const { guest, property, room, bed } = await seedEnvironment();

      const booking = await testDB.booking.create({
        data: {
          propertyId: property.id,
          roomId: room.id,
          bedId: bed.id,
          guestId: guest.id,
          totalPrice: 100,
          startDate: new Date(),
          endDate: new Date(),
          status: "CONFIRMED",
          paymentStatus: "PENDING",
          paymentMode: "ONLINE",
        },
      });

      const { req, res } = setupMockHttp(
        { id: guest.id },
        {},
        {},
        { bookingId: booking.id },
        { sub: guest.auth0Id }
      );

      await executeControllerAndWait(getBookingDetails, req, res, mockNext);

      const payload = res.json.mock.calls[0][0];
      expect(payload.data.id).toBe(booking.id);
      expect(payload.data.bed.id).toBe(bed.id);
    });
  });

  describe("getOccupancy", () => {
    const createBookingRow = (
      seed: Awaited<ReturnType<typeof seedEnvironment>>,
      startDate: Date,
      endDate: Date,
      status: string = "CONFIRMED"
    ) =>
      testDB.booking.create({
        data: {
          propertyId: seed.property.id,
          roomId: seed.room.id,
          bedId: seed.bed.id,
          guestId: seed.guest.id,
          totalPrice: 100,
          startDate,
          endDate,
          status: status as any,
          paymentStatus: "PENDING",
          paymentMode: "ONLINE",
        },
      });

    it("should return only bookings overlapping the requested window", async () => {
      const seed = await seedEnvironment();

      const windowStart = new Date();
      windowStart.setDate(windowStart.getDate() + 10);
      const windowEnd = new Date();
      windowEnd.setDate(windowEnd.getDate() + 20);

      const insideStart = new Date();
      insideStart.setDate(insideStart.getDate() + 12);
      const insideEnd = new Date();
      insideEnd.setDate(insideEnd.getDate() + 15);
      await createBookingRow(seed, insideStart, insideEnd);

      const outsideStart = new Date();
      outsideStart.setDate(outsideStart.getDate() + 30);
      const outsideEnd = new Date();
      outsideEnd.setDate(outsideEnd.getDate() + 35);
      await createBookingRow(seed, outsideStart, outsideEnd);

      const { req, res } = setupMockHttp(
        { id: seed.admin.id },
        {},
        { startDate: windowStart.toISOString(), endDate: windowEnd.toISOString() },
        { propertyId: seed.property.id },
        { sub: seed.admin.auth0Id }
      );

      await executeControllerAndWait(getOccupancy, req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(200);
      const payload = res.json.mock.calls[0][0];
      expect(payload.data.bookings.length).toBe(1);
      expect(payload.data.bookings[0].bed.id).toBe(seed.bed.id);
      expect(payload.data.bookings[0].room.roomTemplateId).toBe(seed.template.id);
      expect(payload.data.beds.length).toBe(1);
      expect(payload.data.beds[0].id).toBe(seed.bed.id);
      expect(payload.data.beds[0].room.roomTemplateId).toBe(seed.template.id);
    });

    it("should throw 400 when the window exceeds 62 days", async () => {
      const seed = await seedEnvironment();

      const start = new Date();
      const end = new Date();
      end.setDate(end.getDate() + 70);

      const { req, res } = setupMockHttp(
        { id: seed.admin.id },
        {},
        { startDate: start.toISOString(), endDate: end.toISOString() },
        { propertyId: seed.property.id },
        { sub: seed.admin.auth0Id }
      );

      try {
        await executeControllerAndWait(getOccupancy, req, res, mockNext);
        throw new Error("Expected getOccupancy to throw");
      } catch (error: any) {
        expect(error.statusCode).toBe(400);
        expect(error.message).toContain("cannot exceed 62 days");
      }
    });

    it("should throw 403 when the admin does not own the property", async () => {
      const seed = await seedEnvironment();

      const otherAdmin = await testDB.user.create({
        data: {
          auth0Id: `auth0|other_${uuidv4()}`,
          email: "other@test.com",
          firstName: "Other",
          role: "Admin",
          tenant: { create: { name: "Tenant 2", slug: `t2_${uuidv4()}` } },
        },
      });

      const { req, res } = setupMockHttp(
        { id: otherAdmin.id },
        {},
        {},
        { propertyId: seed.property.id },
        { sub: otherAdmin.auth0Id }
      );

      try {
        await executeControllerAndWait(getOccupancy, req, res, mockNext);
        throw new Error("Expected getOccupancy to throw");
      } catch (error: any) {
        expect(error.statusCode).toBe(403);
      }
    });
  });

  describe("updateBookingStatus", () => {
    const seedPendingBooking = async () => {
      const seed = await seedEnvironment();
      const start = new Date();
      start.setDate(start.getDate() + 5);
      const end = new Date();
      end.setDate(end.getDate() + 10);

      const booking = await testDB.booking.create({
        data: {
          propertyId: seed.property.id,
          roomId: seed.room.id,
          bedId: seed.bed.id,
          guestId: seed.guest.id,
          totalPrice: 500,
          startDate: start,
          endDate: end,
          status: "PENDING",
          paymentStatus: "PENDING",
          paymentMode: "OFFLINE",
        },
      });

      await testDB.bed.update({
        where: { id: seed.bed.id },
        data: { userId: seed.guest.id },
      });

      return { ...seed, booking };
    };

    it("should approve a pending booking (PENDING -> CONFIRMED)", async () => {
      const { admin, property, booking } = await seedPendingBooking();

      const { req, res } = setupMockHttp(
        { id: admin.id },
        { bookingId: booking.id, action: "APPROVE" },
        {},
        { propertyId: property.id },
        { sub: admin.auth0Id }
      );

      await executeControllerAndWait(updateBookingStatus, req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(200);
      const updated = await testDB.booking.findUnique({ where: { id: booking.id } });
      expect(updated?.status).toBe("CONFIRMED");
    });

    it("should reject a pending booking and free the bed", async () => {
      const { admin, property, booking, bed } = await seedPendingBooking();

      const { req, res } = setupMockHttp(
        { id: admin.id },
        { bookingId: booking.id, action: "REJECT" },
        {},
        { propertyId: property.id },
        { sub: admin.auth0Id }
      );

      await executeControllerAndWait(updateBookingStatus, req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(200);
      const updated = await testDB.booking.findUnique({ where: { id: booking.id } });
      expect(updated?.status).toBe("REJECTED");

      const freedBed = await testDB.bed.findUnique({ where: { id: bed.id } });
      expect(freedBed?.userId).toBeNull();
    });

    it("should throw 400 when the booking is not pending", async () => {
      const { admin, property, booking } = await seedPendingBooking();

      await testDB.booking.update({
        where: { id: booking.id },
        data: { status: "CONFIRMED" },
      });

      const { req, res } = setupMockHttp(
        { id: admin.id },
        { bookingId: booking.id, action: "APPROVE" },
        {},
        { propertyId: property.id },
        { sub: admin.auth0Id }
      );

      try {
        await executeControllerAndWait(updateBookingStatus, req, res, mockNext);
        throw new Error("Expected updateBookingStatus to throw");
      } catch (error: any) {
        expect(error.statusCode).toBe(400);
        expect(error.message).toBe(
          "Only pending bookings can be approved or rejected"
        );
      }
    });

    it("should throw 403 when the admin does not own the property", async () => {
      const { property, booking } = await seedPendingBooking();

      const otherAdmin = await testDB.user.create({
        data: {
          auth0Id: `auth0|other_${uuidv4()}`,
          email: "other2@test.com",
          firstName: "Other",
          role: "Admin",
          tenant: { create: { name: "Tenant 3", slug: `t3_${uuidv4()}` } },
        },
      });

      const { req, res } = setupMockHttp(
        { id: otherAdmin.id },
        { bookingId: booking.id, action: "APPROVE" },
        {},
        { propertyId: property.id },
        { sub: otherAdmin.auth0Id }
      );

      try {
        await executeControllerAndWait(updateBookingStatus, req, res, mockNext);
        throw new Error("Expected updateBookingStatus to throw");
      } catch (error: any) {
        expect(error.statusCode).toBe(403);
      }
    });
  });
});