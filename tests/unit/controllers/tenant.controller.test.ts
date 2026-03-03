import {
  createTenant,
  getAllTenants,
  getTenantDetail,
  updateTenant,
} from "../../../src/controller/tenant.controller";
import { getSecuredClient } from "../../../src/lib/prisma/prisma-rls";
import prisma from "../../../src/lib/prisma/db";
import { ApiError } from "../../../src/lib";

jest.mock("../../../src/lib/index.ts", () => {
  const original = jest.requireActual("../../../src/lib/index.ts");
  return {
    ...original,
    asyncHandler: (fn: any) => (req: any, res: any, next: any) => {
      return Promise.resolve(fn(req, res, next)).catch(next);
    },
  };
});

jest.mock("../../../src/lib/prisma/db.ts", () => ({
  __esModule: true,
  default: {
    tenant: { create: jest.fn(), findFirst: jest.fn() },
    user: { findFirst: jest.fn() },
  },
}));

jest.mock("../../../src/lib/prisma/prisma-rls.ts", () => ({
  getSecuredClient: jest.fn(),
}));

describe("Tenant Controller", () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: any;
  let mockSecuredDb: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockSecuredDb = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      tenant: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
    };
    (getSecuredClient as jest.Mock).mockReturnValue(mockSecuredDb);

    mockReq = {
      user: { id: "user-123", role: "Guest" },
      oidc: { user: { sub: "auth0|123" } },
      body: {},
      query: {},
    };

    mockRes = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };

    mockNext = jest.fn();
  });

  // TEST: createTenant
  describe("createTenant", () => {
    test("should successfully create a tenant and upgrade user role", async () => {
      mockReq.body = { name: "Zappotel NYC", slug: "zappotel-nyc" };

      mockSecuredDb.user.findUnique.mockResolvedValue({
        id: "user-123",
        tenant: null,
      });

      mockSecuredDb.user.update.mockResolvedValue({});

      const fakeTenant = { id: "tenant-99", name: "Zappotel NYC" };
      (prisma.tenant.create as jest.Mock).mockResolvedValue(fakeTenant);

      await createTenant(mockReq, mockRes, mockNext);

      expect(mockSecuredDb.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { role: "Admin" } }),
      );
      expect(prisma.tenant.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: "Zappotel NYC" }),
        }),
      );
      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json.mock.calls[0][0].message).toBe(
        "Tenant created successfully",
      );
    });

    test("should throw 401 if user already has a tenant", async () => {
      mockSecuredDb.user.findUnique.mockResolvedValue({
        id: "user-123",
        tenant: { id: "existing-tenant" },
      });

      await createTenant(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].message).toBe(
        "User already have tenant",
      );
      expect(mockNext.mock.calls[0][0].statusCode).toBe(401);
    });
  });

  // TEST: getAllTenants
  describe("getAllTenants", () => {
    test("should return list of tenants if user is Super_Admin", async () => {
      mockReq.query = { page: "1", limit: "10" };

      (prisma.user.findFirst as jest.Mock).mockResolvedValue({
        id: "user-123",
        role: "Super_Admin",
      });

      const fakeTenants = [{ id: "t1" }, { id: "t2" }];
      mockSecuredDb.tenant.findMany.mockResolvedValue(fakeTenants);
      mockSecuredDb.tenant.count.mockResolvedValue(2);

      await getAllTenants(mockReq, mockRes, mockNext);

      expect(mockSecuredDb.tenant.findMany).toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(200);
      const responseData = mockRes.json.mock.calls[0][0].data;
      expect(responseData.tenants).toEqual(fakeTenants);
      expect(responseData.totalTenants).toBe(2);
    });

    test("should throw 403 if user is NOT Super_Admin", async () => {
      (prisma.user.findFirst as jest.Mock).mockResolvedValue({
        id: "user-123",
        role: "Admin",
      });

      await getAllTenants(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].message).toBe("You are not allowed");
      expect(mockNext.mock.calls[0][0].statusCode).toBe(403);
    });
  });

  // TEST: updateTenant
  describe("updateTenant", () => {
    test("should successfully update tenant and return 200", async () => {
      mockReq.body = {
        name: "Zappotel Updated",
        description: "New Description",
      };

      (prisma.tenant.findFirst as jest.Mock).mockResolvedValue({
        id: "tenant-99",
        userId: "user-123",
      });

      const fakeUpdatedTenant = { id: "tenant-99", name: "Zappotel Updated" };
      mockSecuredDb.tenant.update.mockResolvedValue(fakeUpdatedTenant);

      await updateTenant(mockReq, mockRes, mockNext);

      expect(prisma.tenant.findFirst).toHaveBeenCalledWith({
        where: { userId: "user-123" },
      });

      expect(mockSecuredDb.tenant.update).toHaveBeenCalledWith({
        where: { userId: "user-123" },
        data: expect.objectContaining({
          name: "Zappotel Updated",
          description: "New Description",
        }),
      });

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json.mock.calls[0][0].message).toBe(
        "Tenant updated successfully",
      );
      expect(mockRes.json.mock.calls[0][0].data).toEqual(fakeUpdatedTenant);
    });

    test("should throw 404 if tenant is not found", async () => {
      (prisma.tenant.findFirst as jest.Mock).mockResolvedValue(null);

      await updateTenant(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].message).toBe("Tenant not found");
      expect(mockNext.mock.calls[0][0].statusCode).toBe(404);

      expect(mockSecuredDb.tenant.update).not.toHaveBeenCalled();
    });

    test("should throw 401 if user ID is missing", async () => {
      mockReq.user.id = undefined;

      await updateTenant(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].message).toBe("User ID missing");
      expect(mockNext.mock.calls[0][0].statusCode).toBe(401);
    });
  });

  // TEST: getTenantDetail
  describe("getTenantDetail", () => {
    test("should fetch tenant details and return 200", async () => {
      const fakeUser = {
        id: "user-123",
        role: "Admin",
        tenant: { id: "tenant-99" },
      };
      mockSecuredDb.user.findUnique.mockResolvedValue(fakeUser);

      const fakeTenantDetail = {
        id: "tenant-99",
        name: "Zappotel NYC",
        slug: "zappotel-nyc",
        currency: "USD",
        user: { firstName: "Alex" },
      };
      mockSecuredDb.tenant.findUnique.mockResolvedValue(fakeTenantDetail);

      await getTenantDetail(mockReq, mockRes, mockNext);

      expect(mockSecuredDb.user.findUnique).toHaveBeenCalledWith({
        where: { id: "user-123" },
        include: { tenant: true },
      });

      expect(mockSecuredDb.tenant.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "user-123" },
        }),
      );

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json.mock.calls[0][0].message).toBe(
        "Tenant Fetched successfully",
      );
      expect(mockRes.json.mock.calls[0][0].data).toEqual(fakeTenantDetail);
    });

    test("should throw 400 if user ID is missing from request", async () => {
      mockReq.user.id = undefined;

      await getTenantDetail(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].message).toBe("User ID is required");
      expect(mockNext.mock.calls[0][0].statusCode).toBe(400);
    });

    test("should throw 404 if user is not found in database", async () => {
      mockSecuredDb.user.findUnique.mockResolvedValue(null);

      await getTenantDetail(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].message).toBe("User not found");
      expect(mockNext.mock.calls[0][0].statusCode).toBe(404);
    });

    test("should throw 404 if user is found, but tenant details are missing", async () => {
      mockSecuredDb.user.findUnique.mockResolvedValue({
        id: "user-123",
        role: "Admin",
        tenant: { id: "tenant-99" },
      });
      mockSecuredDb.tenant.findUnique.mockResolvedValue(null);
      await getTenantDetail(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].message).toBe(
        "No tenant found with this ID",
      );
      expect(mockNext.mock.calls[0][0].statusCode).toBe(404);
    });
  });
});
