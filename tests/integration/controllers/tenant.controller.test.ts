import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createTenant,
  getTenantDetail,
  getAllTenants,
  updateTenant,
} from "../../../src/controller/tenant.controller.ts";
import { ApiError } from "../../../src/lib/index.ts";
import testDB from "../../setup.ts";

describe("Integration: Tenant Controller Suite", () => {
  beforeEach(async () => {
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
    oidcUserPayload?: any,
  ) => {
    const req: any = {
      user: reqUser || {},
      body: reqBody || {},
      query: reqQuery || {},
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
      res.json.mockImplementation((data: any) => {
        resolve(data);
      });

      next.mockImplementation((err: any) => {
        reject(err || new Error("next() called without error"));
      });

      controllerFn(req, res, next);
    });
  };

  describe("createTenant", () => {
    it("should throw a 401 ApiError if user ID is missing", async () => {
      const { req, res } = setupMockHttp();

      try {
        await executeControllerAndWait(createTenant, req, res, mockNext);
      } catch (error: any) {
        expect(error).toBeInstanceOf(ApiError);
        expect(error.statusCode).toBe(401);
      }
    });

    it("should throw a 401 ApiError if user already has a tenant", async () => {
      const user = await testDB.user.create({
        data: {
          auth0Id: "auth0|1",
          email: "user1@test.com",
          firstName: "John",
          lastName: "Doe",
          role: "Guest",
          tenant: {
            create: {
              name: "Existing Tenant",
              slug: "existing-tenant",
            },
          },
        },
      });

      const { req, res } = setupMockHttp(
        { id: user.id },
        { name: "New Tenant", slug: "new-tenant" },
      );

      try {
        await executeControllerAndWait(createTenant, req, res, mockNext);
      } catch (error: any) {
        expect(error).toBeInstanceOf(ApiError);
        expect(error.statusCode).toBe(401);
        expect(error.message).toBe("User already has a tenant");
      }
    });

    it("should create a tenant and update user role to Admin", async () => {
      const user = await testDB.user.create({
        data: {
          auth0Id: "auth0|2",
          email: "user2@test.com",
          firstName: "Jane",
          lastName: "Smith",
          role: "Guest",
        },
      });

      const body = {
        name: "Test Tenant",
        slug: "test-tenant",
        description: "A test tenant",
        currency: "USD",
        timezone: "UTC",
      };

      const { req, res } = setupMockHttp({ id: user.id }, body);

      await executeControllerAndWait(createTenant, req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledTimes(1);

      const responsePayload = res.json.mock.calls[0][0];
      expect(responsePayload.data.name).toBe("Test Tenant");
      expect(responsePayload.data.userId).toBe(user.id);

      const updatedUser = await testDB.user.findUnique({
        where: { id: user.id },
      });
      expect(updatedUser?.role).toBe("Admin");
    });
  });

  describe("getTenantDetail", () => {
    it("should throw a 400 ApiError if user ID is missing", async () => {
      const { req, res } = setupMockHttp();

      try {
        await executeControllerAndWait(getTenantDetail, req, res, mockNext);
      } catch (error: any) {
        expect(error).toBeInstanceOf(ApiError);
        expect(error.statusCode).toBe(400);
      }
    });

    it("should fetch tenant details successfully", async () => {
      const user = await testDB.user.create({
        data: {
          auth0Id: "auth0|3",
          email: "user3@test.com",
          firstName: "Alice",
          lastName: "Wonder",
          role: "Admin",
          tenant: {
            create: {
              name: "Alice Tenant",
              slug: "alice-tenant",
              currency: "INR",
            },
          },
        },
      });

      const { req, res } = setupMockHttp({ id: user.id });

      await executeControllerAndWait(getTenantDetail, req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledTimes(1);

      const responsePayload = res.json.mock.calls[0][0];
      expect(responsePayload.data.name).toBe("Alice Tenant");
      expect(responsePayload.data.user.id).toBe(user.id);
    });
  });

  describe("getAllTenants", () => {
    it("should throw a 403 ApiError if user is not Super_Admin", async () => {
      const user = await testDB.user.create({
        data: {
          auth0Id: "auth0|4",
          email: "user4@test.com",
          firstName: "Bob",
          lastName: "Builder",
          role: "Admin",
        },
      });

      const { req, res } = setupMockHttp({ id: user.id });

      try {
        await executeControllerAndWait(getAllTenants, req, res, mockNext);
      } catch (error: any) {
        expect(error).toBeInstanceOf(ApiError);
        expect(error.statusCode).toBe(403);
      }
    });

    it("should fetch paginated tenants for Super_Admin", async () => {
      const superAdmin = await testDB.user.create({
        data: {
          auth0Id: "auth0|5",
          email: "super@test.com",
          firstName: "Super",
          lastName: "Admin",
          role: "Super_Admin",
        },
      });

      const user1 = await testDB.user.create({
        data: {
          auth0Id: "auth0|t1",
          email: "t1@test.com",
          firstName: "T1",
          lastName: "User",
          role: "Admin",
          tenant: { create: { name: "Tenant 1", slug: "t-1" } },
        },
      });

      const user2 = await testDB.user.create({
        data: {
          auth0Id: "auth0|t2",
          email: "t2@test.com",
          firstName: "T2",
          lastName: "User",
          role: "Admin",
          tenant: { create: { name: "Tenant 2", slug: "t-2" } },
        },
      });

      const { req, res } = setupMockHttp(
        { id: superAdmin.id },
        {},
        { page: "1", limit: "10" },
      );

      await executeControllerAndWait(getAllTenants, req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledTimes(1);

      const responsePayload = res.json.mock.calls[0][0];
      expect(responsePayload.data.totalTenants).toBe(2);
      expect(responsePayload.data.tenants.length).toBe(2);
    });
  });

  describe("updateTenant", () => {
    it("should throw a 404 ApiError if tenant is not found for the user", async () => {
      const user = await testDB.user.create({
        data: {
          auth0Id: "auth0|6",
          email: "user6@test.com",
          firstName: "Charlie",
          lastName: "Chaplin",
          role: "Guest",
        },
      });

      const { req, res } = setupMockHttp(
        { id: user.id, role: user.role },
        { name: "Updated Name" },
      );

      try {
        await executeControllerAndWait(updateTenant, req, res, mockNext);
      } catch (error: any) {
        expect(error).toBeInstanceOf(ApiError);
        expect(error.statusCode).toBe(404);
      }
    });

    it("should update tenant details successfully", async () => {
      const user = await testDB.user.create({
        data: {
          auth0Id: "auth0|7",
          email: "user7@test.com",
          firstName: "David",
          lastName: "Blaine",
          role: "Admin",
          tenant: {
            create: {
              name: "Old Name",
              slug: "old-name",
            },
          },
        },
      });

      const updateData = {
        name: "New Name",
        description: "New description",
        currency: "EUR",
      };

      const { req, res } = setupMockHttp(
        { id: user.id, role: user.role },
        updateData,
      );

      await executeControllerAndWait(updateTenant, req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledTimes(1);

      const responsePayload = res.json.mock.calls[0][0];
      expect(responsePayload.data.name).toBe("New Name");
      expect(responsePayload.data.currency).toBe("EUR");

      const dbTenant = await testDB.tenant.findUnique({
        where: { userId: user.id },
      });
      expect(dbTenant?.name).toBe("New Name");
      expect(dbTenant?.description).toBe("New description");
    });
  });
});
