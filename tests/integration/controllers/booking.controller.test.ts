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
} from "../../../src/controller/booking.controller.ts";
import testDB from "../../setup.ts";
import { v4 as uuidv4 } from "uuid";

vi.mock("../../../src/lib/redis/redis-lock.ts", () => ({
  acquireLock: vi.fn().mockResolvedValue(true),
  releaseLock: vi.fn().mockResolvedValue(true),
}));

describe("Integration: Booking Controller Suite", () => {
  beforeEach(async () => {
    await testDB.idempotencyKey.deleteMany({});
    await testDB.booking.deleteMany({});
    await testDB.bed.deleteMany({});
    await testDB.room.deleteMany({});
    await testDB.roomTemplate.deleteMany({});
    await testDB.property.deleteMany({});
    await testDB.tenant.deleteMany({});
    await testDB.user.deleteMany({});
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
        { propertyId: property.id, roomTemplateId: template.id, startDate: tomorrow, endDate: nextWeek },
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
        },
      });

      const { req, res } = setupMockHttp(
        { id: guest.id },
        { bookingId: booking.id }, // ID passed in body as per controller logic
        {},
        {},
        { sub: guest.auth0Id }
      );

      await executeControllerAndWait(getBookingDetails, req, res, mockNext);

      const payload = res.json.mock.calls[0][0];
      expect(payload.data.id).toBe(booking.id);
      expect(payload.data.bed.id).toBe(bed.id);
    });
  });
});