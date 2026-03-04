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

jest.mock("uuid", () => ({
  v4: jest.fn(() => "mocked-uuid"),
}));

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
    property: { findUnique: jest.fn() },
    roomTemplate: { findMany: jest.fn(), findUnique: jest.fn() },
    room: { updateMany: jest.fn() },
  },
}));

jest.mock("../../../src/lib/prisma/prisma-rls.ts", () => ({
  getSecuredClient: jest.fn(),
}));

describe("RoomTemplate Controller", () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: any;
  let mockSecuredDb: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockSecuredDb = {
      user: { findUnique: jest.fn() },
      $transaction: jest.fn(),
    };
    (getSecuredClient as jest.Mock).mockReturnValue(mockSecuredDb);

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
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };

    mockNext = jest.fn();
  });

  // TEST: create room template
  describe("createRoomTemplate", () => {
    test("should successfully create a room template and return 201", async () => {
      mockSecuredDb.user.findUnique.mockResolvedValue({
        id: "user-123",
        role: "Admin",
        auth0Id: "auth0|123",
        tenant: { id: "tenant-99" },
      });

      (prisma.property.findUnique as jest.Mock).mockResolvedValue({
        id: "prop-1",
        adminId: "user-123",
      });

      mockSecuredDb.$transaction.mockImplementation(async (callback: any) => {
        const mockTx = {
          $executeRaw: jest.fn(),
          roomTemplate: {
            create: jest
              .fn()
              .mockResolvedValue({ id: "rt-1", title: "Standard Room" }),
          },
        };
        return callback(mockTx);
      });

      await createRoomTemplate(mockReq, mockRes, mockNext);

      expect(mockSecuredDb.user.findUnique).toHaveBeenCalled();
      expect(prisma.property.findUnique).toHaveBeenCalled();
      expect(mockSecuredDb.$transaction).toHaveBeenCalled();
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
      (prisma.property.findUnique as jest.Mock).mockResolvedValue(null);

      await createRoomTemplate(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(404);
    });

    test("should throw 403 if user is not property admin", async () => {
      mockSecuredDb.user.findUnique.mockResolvedValue({
        id: "user-123",
      });
      (prisma.property.findUnique as jest.Mock).mockResolvedValue({
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
      (prisma.property.findUnique as jest.Mock).mockResolvedValue({
        id: "prop-1",
        adminId: "user-123",
      });

      await createRoomTemplate(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(404);
    });
  });

  // TEST: get room templates
  describe("getRoomTemplates", () => {
    test("should fetch room templates and return 200", async () => {
      mockReq.params = { propertyId: "prop-1" };

      const fakeTemplates = [
        { id: "rt-1", title: "Standard Room", bedsPerRoom: 2 },
      ];

      (prisma.roomTemplate.findMany as jest.Mock).mockResolvedValue(
        fakeTemplates,
      );

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

  // TEST: room template details
  describe("getRoomTemplateDetail", () => {
    test("should fetch room template detail and return 200", async () => {
      mockReq.params = { roomTemplateId: "rt-1" };

      mockSecuredDb.user.findUnique.mockResolvedValue({
        id: "user-123",
        role: "Admin",
        auth0Id: "auth0|123",
        tenant: { id: "tenant-99" },
      });

      if (!mockSecuredDb.roomTemplate) mockSecuredDb.roomTemplate = {};
      const fakeDetail = { id: "rt-1", title: "Suite" };
      mockSecuredDb.roomTemplate.findUnique = jest
        .fn()
        .mockResolvedValue(fakeDetail);

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

  // TEST: update room template
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

      (prisma.property.findUnique as jest.Mock).mockResolvedValue({
        id: "prop-1",
      });

      (prisma.roomTemplate.findUnique as jest.Mock).mockResolvedValue({
        id: "rt-1",
        propertyId: "prop-1",
      });

      if (!mockSecuredDb.roomTemplate) mockSecuredDb.roomTemplate = {};
      const fakeUpdatedTemplate = { id: "rt-1", title: "Updated Room" };
      mockSecuredDb.roomTemplate.update = jest
        .fn()
        .mockResolvedValue(fakeUpdatedTemplate);

      (prisma.room.updateMany as jest.Mock).mockResolvedValue({ count: 5 });

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
      (prisma.property.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.roomTemplate.findUnique as jest.Mock).mockResolvedValue({});

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
      (prisma.property.findUnique as jest.Mock).mockResolvedValue({
        id: "prop-1",
      });
      (prisma.roomTemplate.findUnique as jest.Mock).mockResolvedValue({
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
      (prisma.property.findUnique as jest.Mock).mockResolvedValue({
        id: "prop-1",
      });
      (prisma.roomTemplate.findUnique as jest.Mock).mockResolvedValue({
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
      (prisma.property.findUnique as jest.Mock).mockResolvedValue({
        id: "prop-1",
      });
      (prisma.roomTemplate.findUnique as jest.Mock).mockResolvedValue({
        propertyId: "prop-1",
      });

      if (!mockSecuredDb.roomTemplate) mockSecuredDb.roomTemplate = {};
      mockSecuredDb.roomTemplate.update = jest.fn().mockResolvedValue(null);

      await updateRoomTemplate(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(404);
    });
  });

  // TEST: delete room template
  describe("deleteRoomTemplate", () => {
    test("should delete room template and return 200", async () => {
      mockReq.params = { roomTemplateId: "rt-1", propertyId: "prop-1" };

      mockSecuredDb.user.findUnique.mockResolvedValue({
        id: "user-123",
        tenant: { id: "tenant-99" },
        role: "Admin",
        auth0Id: "auth0|123",
      });

      (prisma.roomTemplate.findUnique as jest.Mock).mockResolvedValue({
        id: "rt-1",
        property: { id: "prop-1", adminId: "user-123" },
        rooms: [{ id: "room-1" }, { id: "room-2" }],
      });

      const fakeDeletedTemplate = { id: "rt-1" };
      mockSecuredDb.$transaction.mockImplementation(async (callback: any) => {
        const mockTx = {
          bed: { deleteMany: jest.fn().mockResolvedValue({}) },
          room: { deleteMany: jest.fn().mockResolvedValue({}) },
          roomTemplate: {
            delete: jest.fn().mockResolvedValue(fakeDeletedTemplate),
          },
        };
        return callback(mockTx);
      });

      await deleteRoomTemplate(mockReq, mockRes, mockNext);

      expect(mockSecuredDb.user.findUnique).toHaveBeenCalled();
      expect(prisma.roomTemplate.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "rt-1" } }),
      );
      expect(mockSecuredDb.$transaction).toHaveBeenCalled();
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
      (prisma.roomTemplate.findUnique as jest.Mock).mockResolvedValue(null);

      await deleteRoomTemplate(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(404);
    });

    test("should throw 403 if property ID does not match", async () => {
      mockReq.params = { roomTemplateId: "rt-1", propertyId: "prop-1" };

      mockSecuredDb.user.findUnique.mockResolvedValue({ id: "user-123" });
      (prisma.roomTemplate.findUnique as jest.Mock).mockResolvedValue({
        property: { id: "prop-WRONG", adminId: "user-123" },
      });

      await deleteRoomTemplate(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(403);
    });

    test("should throw 403 if user is not property admin", async () => {
      mockReq.params = { roomTemplateId: "rt-1", propertyId: "prop-1" };

      mockSecuredDb.user.findUnique.mockResolvedValue({ id: "user-123" });
      (prisma.roomTemplate.findUnique as jest.Mock).mockResolvedValue({
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
      (prisma.roomTemplate.findUnique as jest.Mock).mockResolvedValue({
        property: { id: "prop-1", adminId: "user-123" },
      });

      await deleteRoomTemplate(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      expect(mockNext.mock.calls[0][0].statusCode).toBe(404);
    });
  });
});
