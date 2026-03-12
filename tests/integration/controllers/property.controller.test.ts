import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createProperty,
  updateProperty,
  deleteProperty,
  getAdminProperties,
  getPropertyDetail,
} from "../../../src/controller/property.controller.ts";
import testDB from "../../setup.ts";

describe("Integration: Property Controller Suite", () => {
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
  ) => {
    const req: any = {
      user: reqUser || {},
      body: reqBody || {},
      query: reqQuery || {},
      params: reqParams || {},
      oidc: {
        user: oidcUserPayload || { sub: "auth0|test" },
      },
    };

    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    return { req, res };
  };

  const executeControllerAndWait = (
    controllerFn: Function,
    req: any,
    res: any,
    next: any,
  ) => {
    return new Promise((resolve, reject) => {
      res.json.mockImplementation((data: any) => resolve(data));
      next.mockImplementation((err: any) =>
        reject(err || new Error("next() called without error")),
      );
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

  describe("createProperty", () => {
    it("should throw a 401 ApiError if user ID is missing", async () => {
      const { req, res } = setupMockHttp();
      try {
        await executeControllerAndWait(createProperty, req, res, mockNext);
      } catch (error: any) {
        expect(error.statusCode).toBe(401);
      }
    });

    it("should throw a 404 ApiError if user does not have a tenant", async () => {
      const user = await testDB.user.create({
        data: {
          auth0Id: "auth0|p1",
          email: "p1@test.com",
          firstName: "No",
          lastName: "Tenant",
          role: "Admin",
        },
      });

      const { req, res } = setupMockHttp(
        { id: user.id },
        { title: "Test Prop" },
      );
      try {
        await executeControllerAndWait(createProperty, req, res, mockNext);
      } catch (error: any) {
        expect(error.statusCode).toBe(404);
        expect(error.message).toBe("Tenant not found");
      }
    });

    it("should successfully create a property", async () => {
      const user = await testDB.user.create({
        data: {
          auth0Id: "auth0|p2",
          email: "p2@test.com",
          firstName: "Has",
          lastName: "Tenant",
          role: "Admin",
          tenant: {
            create: { name: "My Tenant", slug: "my-tenant" },
          },
        },
      });

      const propertyData = {
        title: "Sunset Villa",
        type: "Hostel",
        ...baseProperty,
      };

      const { req, res } = setupMockHttp({ id: user.id }, propertyData);
      await executeControllerAndWait(createProperty, req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(201);
      const responsePayload = res.json.mock.calls[0][0];
      expect(responsePayload.data.title).toBe("Sunset Villa");
      expect(responsePayload.data.adminId).toBe(user.id);
    });
  });

  describe("updateProperty", () => {
    it("should throw a 403 Forbidden if property belongs to a different tenant", async () => {
      const user1 = await testDB.user.create({
        data: {
          auth0Id: "auth0|p3",
          email: "u1@test.com",
          firstName: "U1",
          role: "Admin",
          tenant: { create: { name: "Tenant 1", slug: "t1" } },
        },
      });

      const user2 = await testDB.user.create({
        data: {
          auth0Id: "auth0|p4",
          email: "u2@test.com",
          firstName: "U2",
          role: "Admin",
          tenant: { create: { name: "Tenant 2", slug: "t2" } },
        },
        include: { tenant: true },
      });

      const property = await testDB.property.create({
        data: {
          title: "Tenant 2 Property",
          type: "Hostel",
          adminId: user2.id,
          tenantId: user2.tenant!.id,
          ...baseProperty,
        },
      });

      const { req, res } = setupMockHttp(
        { id: user1.id },
        { title: "Hacked Title" },
        {},
        { propertyId: property.id },
      );

      try {
        await executeControllerAndWait(updateProperty, req, res, mockNext);
      } catch (error: any) {
        expect(error.statusCode).toBe(403);
      }
    });

    it("should update the property if owner matches", async () => {
      const user = await testDB.user.create({
        data: {
          auth0Id: "auth0|p5",
          email: "u3@test.com",
          firstName: "U3",
          role: "Admin",
          tenant: { create: { name: "Tenant 3", slug: "t3" } },
        },
        include: { tenant: true },
      });

      const property = await testDB.property.create({
        data: {
          title: "Old Title",
          type: "Hostel",
          adminId: user.id,
          tenantId: user.tenant!.id,
          ...baseProperty,
        },
      });

      const { req, res } = setupMockHttp(
        { id: user.id },
        { title: "New Title" },
        {},
        { propertyId: property.id },
      );

      await executeControllerAndWait(updateProperty, req, res, mockNext);

      const responsePayload = res.json.mock.calls[0][0];
      expect(responsePayload.data.title).toBe("New Title");

      const dbProp = await testDB.property.findUnique({
        where: { id: property.id },
      });
      expect(dbProp?.title).toBe("New Title");
    });
  });

  describe("deleteProperty", () => {
    it("should successfully delete a property", async () => {
      const user = await testDB.user.create({
        data: {
          auth0Id: "auth0|p6",
          email: "u4@test.com",
          firstName: "U4",
          role: "Admin",
          tenant: { create: { name: "Tenant 4", slug: "t4" } },
        },
        include: { tenant: true },
      });

      const property = await testDB.property.create({
        data: {
          title: "To Be Deleted",
          type: "Hostel",
          adminId: user.id,
          tenantId: user.tenant!.id,
          ...baseProperty,
        },
      });

      const { req, res } = setupMockHttp(
        { id: user.id },
        {},
        {},
        { propertyId: property.id },
      );

      await executeControllerAndWait(deleteProperty, req, res, mockNext);

      const responsePayload = res.json.mock.calls[0][0];
      expect(responsePayload.message).toBe("Property deleted Successfully");

      const checkProp = await testDB.property.findUnique({
        where: { id: property.id },
      });
      expect(checkProp).toBeNull();
    });
  });

  describe("getAdminProperties", () => {
    it("should return paginated properties for the tenant", async () => {
      const user = await testDB.user.create({
        data: {
          auth0Id: "auth0|p7",
          email: "u5@test.com",
          firstName: "U5",
          role: "Admin",
          tenant: { create: { name: "Tenant 5", slug: "t5" } },
        },
        include: { tenant: true },
      });

      await testDB.property.createMany({
        data: [
          {
            title: "Prop 1",
            type: "Hostel",
            adminId: user.id,
            tenantId: user.tenant!.id,
            ...baseProperty,
          },
          {
            title: "Prop 2",
            type: "Hostel",
            adminId: user.id,
            tenantId: user.tenant!.id,
            ...baseProperty,
          },
        ],
      });

      const { req, res } = setupMockHttp(
        { id: user.id },
        {},
        { page: "1", limit: "10" },
      );

      await executeControllerAndWait(getAdminProperties, req, res, mockNext);

      const responsePayload = res.json.mock.calls[0][0];
      expect(responsePayload.data.totalProperty).toBe(2);
      expect(responsePayload.data.properties.length).toBe(2);
    });
  });

  describe("getPropertyDetail", () => {
    it("should return property details if found", async () => {
      const user = await testDB.user.create({
        data: {
          auth0Id: "auth0|p8",
          email: "u6@test.com",
          firstName: "U6",
          role: "Admin",
          tenant: { create: { name: "Tenant 6", slug: "t6" } },
        },
        include: { tenant: true },
      });

      const property = await testDB.property.create({
        data: {
          title: "Public Prop",
          type: "Hostel",
          adminId: user.id,
          tenantId: user.tenant!.id,
          ...baseProperty,
        },
      });

      const { req, res } = setupMockHttp(
        { id: user.id },
        {},
        {},
        { propertyId: property.id },
      );

      await executeControllerAndWait(getPropertyDetail, req, res, mockNext);

      const responsePayload = res.json.mock.calls[0][0];
      expect(responsePayload.data.title).toBe("Public Prop");
      expect(responsePayload.data.tenant.name).toBe("Tenant 6");
    });

    it("should throw 404 if property does not exist", async () => {
      const { req, res } = setupMockHttp(
        { id: "some-user" },
        {},
        {},
        { propertyId: "fake-id" },
      );
      try {
        await executeControllerAndWait(getPropertyDetail, req, res, mockNext);
      } catch (error: any) {
        expect(error.statusCode).toBe(404);
        expect(error.message).toBe("No property found with this ID");
      }
    });
  });
});
