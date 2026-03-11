import { describe, test, expect, beforeEach, vi } from "vitest";
import {
  createProperty,
  deleteProperty,
  getAdminProperties,
  getPropertyDetail,
  searchProperty,
  updateProperty,
} from "../../../src/controller/property.controller";
import { getSecuredClient } from "../../../src/lib/prisma/prisma-rls";
import { ApiError } from "../../../src/lib";
import prisma from "../../../src/lib/prisma/db";

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
    property: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    user: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("../../../src/lib/prisma/prisma-rls.ts", () => ({
  getSecuredClient: vi.fn(),
}));

describe("Property Controller", () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: any;
  let mockSecuredDb: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockSecuredDb = {
      user: { findUnique: vi.fn() },
      property: {
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
      },
    };
    (getSecuredClient as any).mockReturnValue(mockSecuredDb);

    mockReq = {
      user: { id: "user-123", role: "Admin" },
      oidc: { user: { sub: "auth0|123" } },
      body: {},
      params: {},
      query: {},
    };

    mockRes = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    };

    mockNext = vi.fn();
  });

  describe("createProperty", () => {
    test("should create property and return 201 success", async () => {
      mockReq.body = { title: "Grand Hotel", type: "Hotel", city: "NYC" };

      mockSecuredDb.user.findUnique.mockResolvedValue({
        id: "user-123",
        role: "Admin",
        tenant: { id: "tenant-99" },
      });

      const fakeProperty = {
        id: "prop-1",
        title: "Grand Hotel",
        tenantId: "tenant-99",
      };
      mockSecuredDb.property.create.mockResolvedValue(fakeProperty);

      await createProperty(mockReq, mockRes, mockNext);

      expect(mockSecuredDb.user.findUnique).toHaveBeenCalledWith({
        where: { id: "user-123" },
        select: expect.any(Object),
      });

      expect(mockSecuredDb.property.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          title: "Grand Hotel",
          tenantId: "tenant-99",
          adminId: "user-123",
        }),
      });

      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json.mock.calls[0][0].message).toBe(
        "Property Created Successfully",
      );
      expect(mockRes.json.mock.calls[0][0].data).toEqual(fakeProperty);
    });

    test("should throw 401 if user ID is missing", async () => {
      mockReq.user.id = undefined;

      await createProperty(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(401);
      expect(mockNext.mock.calls[0][0].message).toBe("User ID is missing");
    });

    test("should throw 404 if user has no tenant", async () => {
      mockSecuredDb.user.findUnique.mockResolvedValue({
        id: "user-123",
        tenant: null,
      });

      await createProperty(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(404);
      expect(mockNext.mock.calls[0][0].message).toBe("Tenant not found");
    });
  });

  describe("updateProperty", () => {
    test("should update property and return 200", async () => {
      mockReq.params = { propertyId: "prop-1" };
      mockReq.body = { title: "Updated Title" };

      const mockUser = {
        id: "user-123",
        role: "Admin",
        auth0Id: "auth0|123",
        tenant: { id: "tenant-99" },
      };

      const mockPropertyOwner = {
        id: "prop-1",
        tenantId: "tenant-99",
      };

      (prisma.user.findUnique as any).mockResolvedValue(mockUser);
      (prisma.property.findUnique as any).mockResolvedValue(mockPropertyOwner);

      const fakeUpdatedProperty = { id: "prop-1", title: "Updated Title" };
      mockSecuredDb.property.update.mockResolvedValue(fakeUpdatedProperty);

      await updateProperty(mockReq, mockRes, mockNext);

      expect(prisma.user.findUnique).toHaveBeenCalled();
      expect(prisma.property.findUnique).toHaveBeenCalled();

      expect(mockSecuredDb.property.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "prop-1" },
          data: expect.objectContaining({ title: "Updated Title" }),
        }),
      );

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json.mock.calls[0][0].data).toEqual(fakeUpdatedProperty);
    });

    test("should throw 400 if propertyId is missing", async () => {
      mockReq.params = {};

      await updateProperty(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(400);
    });

    test("should throw 401 if user ID is missing", async () => {
      mockReq.params = { propertyId: "prop-1" };
      mockReq.user.id = undefined;

      await updateProperty(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(401);
    });

    test("should throw 404 if user not found", async () => {
      mockReq.params = { propertyId: "prop-1" };
      (prisma.user.findUnique as any).mockResolvedValue(null);
      (prisma.property.findUnique as any).mockResolvedValue({});

      await updateProperty(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(404);
      expect(mockNext.mock.calls[0][0].message).toBe("User not found");
    });

    test("should throw 404 if tenant not found", async () => {
      mockReq.params = { propertyId: "prop-1" };
      (prisma.user.findUnique as any).mockResolvedValue({
        id: "user-123",
        tenant: null,
      });
      (prisma.property.findUnique as any).mockResolvedValue({});

      await updateProperty(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(404);
      expect(mockNext.mock.calls[0][0].message).toBe("Tenant not found");
    });

    test("should throw 403 if tenant IDs do not match", async () => {
      mockReq.params = { propertyId: "prop-1" };
      (prisma.user.findUnique as any).mockResolvedValue({
        id: "user-123",
        tenant: { id: "tenant-99" },
      });
      (prisma.property.findUnique as any).mockResolvedValue({
        id: "prop-1",
        tenantId: "tenant-WRONG",
      });

      await updateProperty(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(403);
    });
  });

  describe("deleteProperty", () => {
    test("should delete property and return 200", async () => {
      mockReq.params = { propertyId: "prop-1" };

      const mockUser = {
        id: "user-123",
        role: "Admin",
        auth0Id: "auth0|123",
        tenant: { id: "tenant-99" },
      };

      const mockPropertyOwner = {
        id: "prop-1",
        tenantId: "tenant-99",
      };

      (prisma.user.findUnique as any).mockResolvedValue(mockUser);
      (prisma.property.findUnique as any).mockResolvedValue(mockPropertyOwner);

      const fakeDeletedProperty = { id: "prop-1", title: "Deleted Property" };
      mockSecuredDb.property.delete.mockResolvedValue(fakeDeletedProperty);

      await deleteProperty(mockReq, mockRes, mockNext);

      expect(prisma.user.findUnique).toHaveBeenCalled();
      expect(prisma.property.findUnique).toHaveBeenCalled();
      expect(mockSecuredDb.property.delete).toHaveBeenCalledWith({
        where: { id: "prop-1" },
      });

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json.mock.calls[0][0].data).toEqual(fakeDeletedProperty);
    });

    test("should throw 400 if propertyId is missing", async () => {
      mockReq.params = {};

      await deleteProperty(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(400);
    });

    test("should throw 401 if user ID is missing", async () => {
      mockReq.params = { propertyId: "prop-1" };
      mockReq.user.id = undefined;

      await deleteProperty(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(401);
    });

    test("should throw 404 if user not found", async () => {
      mockReq.params = { propertyId: "prop-1" };
      (prisma.user.findUnique as any).mockResolvedValue(null);
      (prisma.property.findUnique as any).mockResolvedValue({});

      await deleteProperty(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(404);
    });

    test("should throw 404 if tenant not found", async () => {
      mockReq.params = { propertyId: "prop-1" };
      (prisma.user.findUnique as any).mockResolvedValue({
        id: "user-123",
        tenant: null,
      });
      (prisma.property.findUnique as any).mockResolvedValue({});

      await deleteProperty(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(404);
    });

    test("should throw 403 if tenant IDs do not match", async () => {
      mockReq.params = { propertyId: "prop-1" };
      (prisma.user.findUnique as any).mockResolvedValue({
        id: "user-123",
        tenant: { id: "tenant-99" },
      });
      (prisma.property.findUnique as any).mockResolvedValue({
        id: "prop-1",
        tenantId: "tenant-WRONG",
      });

      await deleteProperty(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(403);
    });

    test("should throw 404 if deleteProperty returns null", async () => {
      mockReq.params = { propertyId: "prop-1" };
      (prisma.user.findUnique as any).mockResolvedValue({
        id: "user-123",
        tenant: { id: "tenant-99" },
      });
      (prisma.property.findUnique as any).mockResolvedValue({
        id: "prop-1",
        tenantId: "tenant-99",
      });
      mockSecuredDb.property.delete.mockResolvedValue(null);

      await deleteProperty(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(404);
    });
  });

  describe("getAdminProperties", () => {
    test("should return paginated properties and 200 status", async () => {
      mockReq.query = { page: "1", limit: "10" };

      mockSecuredDb.user.findUnique.mockResolvedValue({
        id: "user-123",
        role: "Admin",
        auth0Id: "auth0|123",
        tenant: { id: "tenant-99" },
      });

      const fakeProperties = [
        { id: "prop-1", title: "Hotel A" },
        { id: "prop-2", title: "Hotel B" },
      ];
      mockSecuredDb.property.findMany.mockResolvedValue(fakeProperties);
      mockSecuredDb.property.count.mockResolvedValue(2);

      await getAdminProperties(mockReq, mockRes, mockNext);

      expect(mockSecuredDb.user.findUnique).toHaveBeenCalled();
      expect(mockSecuredDb.property.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: "tenant-99" },
          take: 10,
          skip: 0,
        }),
      );
      expect(mockSecuredDb.property.count).toHaveBeenCalledWith({
        where: { tenantId: "tenant-99" },
      });

      expect(mockRes.status).toHaveBeenCalledWith(200);
      const responseData = mockRes.json.mock.calls[0][0].data;
      expect(responseData.properties).toEqual(fakeProperties);
      expect(responseData.totalProperty).toBe(2);
      expect(responseData.totalPages).toBe(1);
    });

    test("should throw 401 if user ID is missing", async () => {
      mockReq.user.id = undefined;

      await getAdminProperties(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(401);
    });

    test("should throw 404 if user not found", async () => {
      mockSecuredDb.user.findUnique.mockResolvedValue(null);

      await getAdminProperties(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(404);
      expect(mockNext.mock.calls[0][0].message).toBe("User not found");
    });

    test("should throw 404 if tenant not found", async () => {
      mockSecuredDb.user.findUnique.mockResolvedValue({
        id: "user-123",
        tenant: null,
      });

      await getAdminProperties(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(404);
      expect(mockNext.mock.calls[0][0].message).toBe("Tenant not found");
    });

    test("should return 404 JSON response if properties are not found", async () => {
      mockSecuredDb.user.findUnique.mockResolvedValue({
        id: "user-123",
        role: "Admin",
        tenant: { id: "tenant-99" },
      });

      mockSecuredDb.property.findMany.mockResolvedValue(null);
      mockSecuredDb.property.count.mockResolvedValue(0);

      await getAdminProperties(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json.mock.calls[0][0].message).toBe("No Property found");
    });
  });

  describe("getPropertyDetail", () => {
    test("should return property details and 200 status", async () => {
      mockReq.params = { propertyId: "prop-1" };
      mockReq.user = { id: "user-123" };

      const fakePropertyDetail = {
        id: "prop-1",
        title: "Grand Hotel",
        tenant: { id: "tenant-99", name: "Zappotel" },
      };

      (prisma.property.findUnique as any).mockResolvedValue(fakePropertyDetail);

      await getPropertyDetail(mockReq, mockRes, mockNext);

      expect(prisma.property.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "prop-1" },
        }),
      );
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json.mock.calls[0][0].data).toEqual(fakePropertyDetail);
    });

    test("should throw 400 if propertyId is missing", async () => {
      mockReq.params = {};

      await getPropertyDetail(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(400);
    });

    test("should throw 404 if property is not found", async () => {
      mockReq.params = { propertyId: "prop-1" };

      (prisma.property.findUnique as any).mockResolvedValue(null);

      await getPropertyDetail(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(404);
    });
  });

  describe("searchProperty", () => {
    test("should return matching properties and 200 status", async () => {
      mockReq.query = { property: "Luxury Hotel", page: "1", limit: "10" };

      const fakeProperties = [
        { id: "prop-1", title: "Luxury Hotel NYC", city: "NYC", state: "NY" },
      ];

      (prisma.$transaction as any).mockResolvedValue([fakeProperties, 1]);

      await searchProperty(mockReq, mockRes, mockNext);

      expect(prisma.$transaction).toHaveBeenCalled();

      expect(mockRes.status).toHaveBeenCalledWith(200);
      const responseData = mockRes.json.mock.calls[0][0].data;
      expect(responseData.properties).toEqual(fakeProperties);
      expect(responseData.totalProperty).toBe(1);
      expect(responseData.totalPages).toBe(1);
    });

    test("should throw 400 if search input is missing or empty", async () => {
      mockReq.query = { property: "   " };

      await searchProperty(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(400);
      expect(mockNext.mock.calls[0][0].message).toBe(
        "Input required to search properties",
      );
    });

    test("should throw 404 if no properties match search criteria", async () => {
      mockReq.query = { property: "NonExistentHotel" };

      (prisma.$transaction as any).mockResolvedValue([[], 0]);

      await searchProperty(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(404);
      expect(mockNext.mock.calls[0][0].message).toBe(
        "No properties match your search criteria",
      );
    });
  });
});
