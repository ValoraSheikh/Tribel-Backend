import { describe, test, expect, beforeEach, vi } from "vitest";
import {
  createRoomTemplate,
  getRoomTemplateDetail,
  getRoomTemplates,
  updateRoomTemplate,
  deleteRoomTemplate,
} from "../../../src/controller/roomTemplate.controller";
import { getSecuredClient } from "../../../src/lib/prisma/prisma-rls";
import prisma from "../../../src/lib/prisma/db";
import { ApiError } from "../../../src/lib";

// --- FIXED: ADDED REDIS MOCK ---
vi.mock("../../../src/lib/redis/redis-cache.ts", () => ({
  default: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(),
    del: vi.fn(),
  },
}));

vi.mock("uuid", () => ({
  v4: vi.fn(() => "mocked-uuid"),
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
    property: { findUnique: vi.fn() },
    roomTemplate: { findMany: vi.fn(), findUnique: vi.fn() },
    room: { updateMany: vi.fn() },
    $transaction: vi.fn(), // --- FIXED: ADDED TRANSACTION MOCK HERE ---
  },
}));

vi.mock("../../../src/lib/prisma/prisma-rls.ts", () => ({
  getSecuredClient: vi.fn(),
}));

describe("RoomTemplate Controller", () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: any;
  let mockSecuredDb: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockSecuredDb = {
      user: { findUnique: vi.fn() },
      // --- FIXED: ADDED MISSING MOCKS TO PREVENT TYPE ERRORS ---
      roomTemplate: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
      booking: { deleteMany: vi.fn() }, 
    };
    (getSecuredClient as any).mockReturnValue(mockSecuredDb);

    mockReq = {
      params: { propertyId: "prop-1" },
      body: {
        title: "Standard Room",
        bedsPerRoom: 2,
        numberOfRooms: 10,
        pricePerBed: 50,
      },
      user: { id: "user-123" },
      oidc: { user: { id: "auth0|123", sub: "auth0|123" } },
    };

    mockRes = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    };

    mockNext = vi.fn();
  });

  describe("createRoomTemplate", () => {
    test("should successfully create a room template and return 201", async () => {
      mockSecuredDb.user.findUnique.mockResolvedValue({
        id: "user-123",
        role: "Admin",
        auth0Id: "auth0|123",
        tenant: { id: "tenant-99" },
      });

      (prisma.property.findUnique as any).mockResolvedValue({
        id: "prop-1",
        adminId: "user-123",
      });

      // --- FIXED: MOCKED PRISMA INSTEAD OF SECURED DB ---
      (prisma.$transaction as any).mockImplementation(async (callback: any) => {
        const mockTx = {
          $executeRaw: vi.fn(),
          roomTemplate: {
            create: vi
              .fn()
              .mockResolvedValue({ id: "rt-1", title: "Standard Room" }),
          },
        };
        return callback(mockTx);
      });

      await createRoomTemplate(mockReq, mockRes, mockNext);

      expect(mockSecuredDb.user.findUnique).toHaveBeenCalled();
      expect(prisma.property.findUnique).toHaveBeenCalled();
      expect(prisma.$transaction).toHaveBeenCalled(); // --- FIXED ---
      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json.mock.calls[0][0].message).toBe(
        "Room Template created successfully",
      );
    });

    test("should throw 400 if propertyId is missing", async () => {
      mockReq.params = {};

      await createRoomTemplate(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(400);
    });

    test("should throw 400 if room or bed limits are exceeded", async () => {
      mockReq.body.numberOfRooms = 300;

      await createRoomTemplate(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(400);
    });

    test("should throw 404 if property or user not found", async () => {
      mockSecuredDb.user.findUnique.mockResolvedValue(null);
      (prisma.property.findUnique as any).mockResolvedValue(null);

      await createRoomTemplate(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(404);
    });

    test("should throw 403 if user is not property admin", async () => {
      mockSecuredDb.user.findUnique.mockResolvedValue({
        id: "user-123",
      });
      (prisma.property.findUnique as any).mockResolvedValue({
        id: "prop-1",
        adminId: "user-DIFFERENT",
      });

      await createRoomTemplate(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(403);
    });

    test("should throw 404 if tenant is not found", async () => {
      mockSecuredDb.user.findUnique.mockResolvedValue({
        id: "user-123",
        tenant: null,
      });
      (prisma.property.findUnique as any).mockResolvedValue({
        id: "prop-1",
        adminId: "user-123",
      });

      await createRoomTemplate(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(404);
    });
  });

  describe("getRoomTemplates", () => {
    test("should fetch room templates and return 200", async () => {
      mockReq.params = { propertyId: "prop-1" };

      const fakeTemplates = [
        { id: "rt-1", title: "Standard Room", bedsPerRoom: 2 },
      ];

      (prisma.roomTemplate.findMany as any).mockResolvedValue(fakeTemplates);

      await getRoomTemplates(mockReq, mockRes, mockNext);

      expect(prisma.roomTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { propertyId: "prop-1" },
        }),
      );
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json.mock.calls[0][0].data).toEqual(fakeTemplates);
    });

    test("should throw 400 if propertyId is missing", async () => {
      mockReq.params = {};

      await getRoomTemplates(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(400);
    });
  });

  describe("getRoomTemplateDetail", () => {
    test("should fetch room template detail and return 200", async () => {
      mockReq.params = { roomTemplateId: "rt-1" };

      mockSecuredDb.user.findUnique.mockResolvedValue({
        id: "user-123",
        role: "Admin",
        auth0Id: "auth0|123",
        tenant: { id: "tenant-99" },
      });

      const fakeDetail = { id: "rt-1", title: "Suite" };
      mockSecuredDb.roomTemplate.findUnique.mockResolvedValue(fakeDetail);

      await getRoomTemplateDetail(mockReq, mockRes, mockNext);

      expect(mockSecuredDb.user.findUnique).toHaveBeenCalled();
      expect(mockSecuredDb.roomTemplate.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "rt-1" },
        }),
      );
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json.mock.calls[0][0].data).toEqual(fakeDetail);
    });

    test("should throw 404 if user not found", async () => {
      mockReq.params = { roomTemplateId: "rt-1" };
      mockSecuredDb.user.findUnique.mockResolvedValue(null);

      await getRoomTemplateDetail(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(404);
    });

    test("should throw 400 if roomTemplateId is missing", async () => {
      mockReq.params = {};

      mockSecuredDb.user.findUnique.mockResolvedValue({
        id: "user-123",
        tenant: { id: "tenant-99" },
      });

      await getRoomTemplateDetail(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(400);
    });

    test("should throw 404 if tenant not found", async () => {
      mockReq.params = { roomTemplateId: "rt-1" };

      mockSecuredDb.user.findUnique.mockResolvedValue({
        id: "user-123",
        tenant: null,
      });

      await getRoomTemplateDetail(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(404);
    });
  });

  describe("updateRoomTemplate", () => {
    test("should update room template and return 200", async () => {
      mockReq.params = { roomTemplateId: "rt-1", propertyId: "prop-1" };
      mockReq.body = { title: "Updated Room", pricePerBed: 100 };

      mockSecuredDb.user.findUnique.mockResolvedValue({
        id: "user-123",
        role: "Admin",
        auth0Id: "auth0|123",
        tenant: { id: "tenant-99" },
      });

      (prisma.property.findUnique as any).mockResolvedValue({
        id: "prop-1",
        adminId: "user-123"
      });

      (prisma.roomTemplate.findUnique as any).mockResolvedValue({
        id: "rt-1",
        propertyId: "prop-1",
      });

      const fakeUpdatedTemplate = { id: "rt-1", title: "Updated Room" };
      mockSecuredDb.roomTemplate.update.mockResolvedValue(fakeUpdatedTemplate);

      (prisma.room.updateMany as any).mockResolvedValue({ count: 5 });

      await updateRoomTemplate(mockReq, mockRes, mockNext);

      expect(mockSecuredDb.roomTemplate.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "rt-1" },
          data: expect.objectContaining({
            title: "Updated Room",
            pricePerBed: 100,
          }),
        }),
      );
      expect(prisma.room.updateMany).toHaveBeenCalledWith({
        where: { roomTemplateId: "rt-1" },
        data: { pricePerBed: 100 },
      });
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json.mock.calls[0][0].data).toEqual(fakeUpdatedTemplate);
    });

    test("should throw 400 if IDs are missing", async () => {
      mockReq.params = { roomTemplateId: "rt-1" };

      await updateRoomTemplate(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(400);
    });

    test("should throw 404 if property or user not found", async () => {
      mockReq.params = { roomTemplateId: "rt-1", propertyId: "prop-1" };

      mockSecuredDb.user.findUnique.mockResolvedValue(null);
      (prisma.property.findUnique as any).mockResolvedValue(null);
      (prisma.roomTemplate.findUnique as any).mockResolvedValue({});

      await updateRoomTemplate(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(404);
    });

    test("should throw 403 if room template propertyId does not match", async () => {
      mockReq.params = { roomTemplateId: "rt-1", propertyId: "prop-1" };

      mockSecuredDb.user.findUnique.mockResolvedValue({
        id: "user-123",
        tenant: {},
      });
      (prisma.property.findUnique as any).mockResolvedValue({
        id: "prop-1",
        adminId: "user-123" // --- FIXED ---
      });
      (prisma.roomTemplate.findUnique as any).mockResolvedValue({
        propertyId: "prop-WRONG",
      });

      await updateRoomTemplate(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(403);
    });

    test("should throw 400 if tenant not found", async () => {
      mockReq.params = { roomTemplateId: "rt-1", propertyId: "prop-1" };

      mockSecuredDb.user.findUnique.mockResolvedValue({
        id: "user-123",
        tenant: null,
      });
      (prisma.property.findUnique as any).mockResolvedValue({
        id: "prop-1",
        adminId: "user-123" // --- FIXED: Prevented premature 403 ---
      });
      (prisma.roomTemplate.findUnique as any).mockResolvedValue({
        propertyId: "prop-1",
      });

      await updateRoomTemplate(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(400);
    });

    test("should throw 404 if update returns null", async () => {
      mockReq.params = { roomTemplateId: "rt-1", propertyId: "prop-1" };

      mockSecuredDb.user.findUnique.mockResolvedValue({
        id: "user-123",
        tenant: { id: "t-1" },
      });
      (prisma.property.findUnique as any).mockResolvedValue({
        id: "prop-1",
        adminId: "user-123" // --- FIXED: Prevented premature 403 ---
      });
      (prisma.roomTemplate.findUnique as any).mockResolvedValue({
        propertyId: "prop-1",
      });

      mockSecuredDb.roomTemplate.update.mockResolvedValue(null);

      await updateRoomTemplate(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(404);
    });
  });

  describe("deleteRoomTemplate", () => {
    test("should delete room template and return 200", async () => {
      mockReq.params = { roomTemplateId: "rt-1", propertyId: "prop-1" };

      mockSecuredDb.user.findUnique.mockResolvedValue({
        id: "user-123",
        tenant: { id: "tenant-99" },
        role: "Admin",
        auth0Id: "auth0|123",
      });

      (prisma.roomTemplate.findUnique as any).mockResolvedValue({
        id: "rt-1",
        property: { id: "prop-1", adminId: "user-123" },
        rooms: [{ id: "room-1" }, { id: "room-2" }],
      });

      const fakeDeletedTemplate = { id: "rt-1" };
      
      // --- FIXED: MOCKED PRISMA INSTEAD OF SECURED DB ---
      (prisma.$transaction as any).mockImplementation(async (callback: any) => {
        const mockTx = {
          $executeRaw: vi.fn(),
          bed: { deleteMany: vi.fn().mockResolvedValue({}) },
          room: { deleteMany: vi.fn().mockResolvedValue({}) },
          roomTemplate: {
            delete: vi.fn().mockResolvedValue(fakeDeletedTemplate),
          },
        };
        return callback(mockTx);
      });

      await deleteRoomTemplate(mockReq, mockRes, mockNext);

      expect(mockSecuredDb.user.findUnique).toHaveBeenCalled();
      expect(prisma.roomTemplate.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "rt-1" } }),
      );
      expect(prisma.$transaction).toHaveBeenCalled(); // --- FIXED ---
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json.mock.calls[0][0].data).toEqual(fakeDeletedTemplate);
    });

    test("should throw 400 if IDs are missing", async () => {
      mockReq.params = { roomTemplateId: "rt-1" };

      await deleteRoomTemplate(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(400);
    });

    test("should throw 404 if user or roomTemplate not found", async () => {
      mockReq.params = { roomTemplateId: "rt-1", propertyId: "prop-1" };

      mockSecuredDb.user.findUnique.mockResolvedValue(null);
      (prisma.roomTemplate.findUnique as any).mockResolvedValue(null);

      await deleteRoomTemplate(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(404);
    });

    test("should throw 403 if property ID does not match", async () => {
      mockReq.params = { roomTemplateId: "rt-1", propertyId: "prop-1" };

      mockSecuredDb.user.findUnique.mockResolvedValue({ id: "user-123" });
      (prisma.roomTemplate.findUnique as any).mockResolvedValue({
        property: { id: "prop-WRONG", adminId: "user-123" },
      });

      await deleteRoomTemplate(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(403);
    });

    test("should throw 403 if user is not property admin", async () => {
      mockReq.params = { roomTemplateId: "rt-1", propertyId: "prop-1" };

      mockSecuredDb.user.findUnique.mockResolvedValue({ id: "user-123" });
      (prisma.roomTemplate.findUnique as any).mockResolvedValue({
        property: { id: "prop-1", adminId: "user-DIFFERENT" },
      });

      await deleteRoomTemplate(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(403);
    });

    test("should throw 404 if tenant is missing", async () => {
      mockReq.params = { roomTemplateId: "rt-1", propertyId: "prop-1" };

      mockSecuredDb.user.findUnique.mockResolvedValue({
        id: "user-123",
        tenant: null,
      });
      (prisma.roomTemplate.findUnique as any).mockResolvedValue({
        property: { id: "prop-1", adminId: "user-123" },
      });

      await deleteRoomTemplate(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(404);
    });
  });
});