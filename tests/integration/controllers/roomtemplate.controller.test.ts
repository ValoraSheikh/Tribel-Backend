import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createRoomTemplate,
  getRoomTemplates,
  getRoomTemplateDetail,
  updateRoomTemplate,
  deleteRoomTemplate,
} from "../../../src/controller/roomTemplate.controller.ts";
import testDB from "../../setup.ts";

describe("Integration: Room Template Controller Suite", () => {
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
    oidcUserPayload?: any
  ) => {
    const req: any = {
      user: reqUser || {},
      body: reqBody || {},
      query: reqQuery || {},
      params: reqParams || {},
      oidc: {
        user: oidcUserPayload || { id: "auth0|test", sub: "auth0|test" },
      },
    };

    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    return { req, res };
  };

  const executeControllerAndWait = (
    controllerFn: (req: Request, res: Response, next: NextFunction) => void,
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

  const baseProperty = {
    address: "123 Test St",
    city: "Test City",
    state: "TS",
    country: "Testland",
    postal_code: "12345",
    contact_email: "test@test.com",
    contact_phone: "1234567890",
    latitude: 12.3456,
    longitude: 78.9101,
  };

  const seedAdminUserAndProperty = async () => {
    const user = await testDB.user.create({
      data: {
        auth0Id: "auth0|rt1",
        email: "admin@test.com",
        firstName: "Admin",
        role: "Admin",
        tenant: { create: { name: "Tenant 1", slug: "t1" } },
      },
      include: { tenant: true },
    });

    const property = await testDB.property.create({
      data: {
        title: "Test Property",
        type: "Hostel",
        adminId: user.id,
        tenantId: user.tenant!.id,
        ...baseProperty,
      },
    });

    return { user, property, tenant: user.tenant };
  };

  describe("createRoomTemplate", () => {
    it("should throw a 400 ApiError if limits are exceeded", async () => {
      const { req, res } = setupMockHttp(
        { id: "some-id" },
        { numberOfRooms: 300, bedsPerRoom: 10 },
        {},
        { propertyId: "prop-id" }
      );

      try {
        await executeControllerAndWait(createRoomTemplate, req, res, mockNext);
      } catch (error: any) {
        expect(error.statusCode).toBe(400);
        expect(error.message).toContain("Limits: Number of rooms can't be more than");
      }
    });

    it("should throw a 403 if user is not the property admin", async () => {
      const { property } = await seedAdminUserAndProperty();
      const unauthorizedUser = await testDB.user.create({
        data: {
          auth0Id: "auth0|rt2",
          email: "hacker@test.com",
          firstName: "Hacker",
          role: "Admin",
          tenant: { create: { name: "Hacker Tenant", slug: "h-t" } },
        },
      });

      const { req, res } = setupMockHttp(
        { id: unauthorizedUser.id },
        { title: "Hacked Room", numberOfRooms: 5, bedsPerRoom: 2, pricePerBed: 100 },
        {},
        { propertyId: property.id }
      );

      try {
        await executeControllerAndWait(createRoomTemplate, req, res, mockNext);
      } catch (error: any) {
        expect(error.statusCode).toBe(403);
      }
    });

    it("should successfully create a room template, rooms, and beds", async () => {
      const { user, property } = await seedAdminUserAndProperty();

      const templateData = {
        title: "Standard Dorm",
        description: "A nice dorm",
        bedsPerRoom: 4,
        numberOfRooms: 2,
        pricePerBed: 50,
        type: "Dormitory",
        image: "test-image-url.jpg",
      };

      const { req, res } = setupMockHttp(
        { id: user.id },
        templateData,
        {},
        { propertyId: property.id },
        { id: user.auth0Id, sub: user.auth0Id }
      );

      await executeControllerAndWait(createRoomTemplate, req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(201);
      
      const templates = await testDB.roomTemplate.findMany({
        where: { propertyId: property.id },
        include: { rooms: { include: { beds: true } } },
      });

      expect(templates.length).toBe(1);
      expect(templates[0]?.title).toBe("Standard Dorm");
      expect(templates[0]?.rooms.length).toBe(2);
      expect(templates[0]?.rooms[0]?.beds.length).toBe(4);
    });
  });

  describe("getRoomTemplates", () => {
    it("should fetch all room templates for a property", async () => {
      const { property } = await seedAdminUserAndProperty();

      await testDB.roomTemplate.create({
        data: {
          title: "Dorm 1",
          bedsPerRoom: 2,
          numberOfRooms: 1,
          pricePerBed: 10,
          type: "Dormitory",
          image: "test-image-url.jpg",
          propertyId: property.id,
        },
      });

      const { req, res } = setupMockHttp({}, {}, {}, { propertyId: property.id });

      await executeControllerAndWait(getRoomTemplates, req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(200);
      const responsePayload = res.json.mock.calls[0][0];
      expect(responsePayload.data.length).toBe(1);
      expect(responsePayload.data[0].title).toBe("Dorm 1");
    });
  });

  describe("getRoomTemplateDetail", () => {
    it("should fetch details of a specific room template", async () => {
      const { user, property } = await seedAdminUserAndProperty();

      const template = await testDB.roomTemplate.create({
        data: {
          title: "Private Room",
          bedsPerRoom: 1,
          numberOfRooms: 1,
          pricePerBed: 100,
          type: "Private",
          image: "test-image-url.jpg",
          propertyId: property.id,
        },
      });

      const { req, res } = setupMockHttp(
        { id: user.id },
        {},
        {},
        { roomTemplateId: template.id },
        { id: user.auth0Id, sub: user.auth0Id }
      );

      await executeControllerAndWait(getRoomTemplateDetail, req, res, mockNext);

      const responsePayload = res.json.mock.calls[0][0];
      expect(responsePayload.data.title).toBe("Private Room");
      expect(responsePayload.data.id).toBe(template.id);
    });
  });

  describe("updateRoomTemplate", () => {
    it("should update room template and update associated room prices", async () => {
      const { user, property } = await seedAdminUserAndProperty();

      const template = await testDB.roomTemplate.create({
        data: {
          title: "Old Title",
          bedsPerRoom: 2,
          numberOfRooms: 1,
          pricePerBed: 20,
          type: "Dormitory",
          image: "test-image-url.jpg",
          propertyId: property.id,
        },
      });

      await testDB.room.create({
        data: {
          title: "Room 1",
          bedCount: 2,
          pricePerBed: 20,
          propertyId: property.id,
          roomTemplateId: template.id,
        },
      });

      const updateData = {
        title: "New Title",
        pricePerBed: 30,
      };

      const { req, res } = setupMockHttp(
        { id: user.id },
        updateData,
        {},
        { propertyId: property.id, roomTemplateId: template.id },
        { sub: user.auth0Id }
      );

      await executeControllerAndWait(updateRoomTemplate, req, res, mockNext);

      const responsePayload = res.json.mock.calls[0][0];
      expect(responsePayload.data.title).toBe("New Title");
      expect(responsePayload.data.pricePerBed).toBe(30);

      const updatedRooms = await testDB.room.findMany({
        where: { roomTemplateId: template.id },
      });
      expect(Number(updatedRooms[0]?.pricePerBed)).toBe(30);
    });
  });

  describe("deleteRoomTemplate", () => {
    it("should completely delete the room template and cascade to beds and rooms", async () => {
      const { user, property } = await seedAdminUserAndProperty();

      const template = await testDB.roomTemplate.create({
        data: {
          title: "To Be Deleted",
          bedsPerRoom: 1,
          numberOfRooms: 1,
          pricePerBed: 50,
          type: "Dormitory",
          image: "test-image-url.jpg",
          propertyId: property.id,
        },
      });

      const room = await testDB.room.create({
        data: {
          title: "Room X",
          bedCount: 1,
          pricePerBed: 50,
          propertyId: property.id,
          roomTemplateId: template.id,
        },
      });

      await testDB.bed.create({
        data: {
          roomId: room.id,
          bedNo: 1,
        },
      });

      const { req, res } = setupMockHttp(
        { id: user.id },
        {},
        {},
        { propertyId: property.id, roomTemplateId: template.id },
        { id: user.auth0Id, sub: user.auth0Id }
      );

      await executeControllerAndWait(deleteRoomTemplate, req, res, mockNext);

      const checkTemplate = await testDB.roomTemplate.findUnique({ where: { id: template.id } });
      expect(checkTemplate).toBeNull();

      const checkRooms = await testDB.room.findMany({ where: { roomTemplateId: template.id } });
      expect(checkRooms.length).toBe(0);

      const checkBeds = await testDB.bed.findMany({ where: { roomId: room.id } });
      expect(checkBeds.length).toBe(0);
    });
  });
});