import { describe, test, expect, beforeEach, vi } from "vitest";
import {
  deleteUser,
  loginUser,
  logout,
  updateUserProfile,
} from "../../../src/controller/user.controller";
import { getSecuredClient } from "../../../src/lib/prisma/prisma-rls";
import { ApiError } from "../../../src/lib";

// --- ADDED: REDIS MOCKS TO PREVENT CRASHES ---
vi.mock("../../../src/lib/redis/redis-cache.ts", () => ({
  default: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(),
    del: vi.fn(),
  },
}));

vi.mock("../../../src/lib/redis/redis.ts", () => ({
  default: {},
}));

vi.mock("../../../src/lib/prisma/db.ts", () => ({
  prisma: {},
}));

vi.mock("../../../src/lib/prisma/prisma-rls.ts", () => ({
  getSecuredClient: vi.fn(),
}));

vi.mock("../../../src/lib/index.ts", async () => {
  const originalModule = await vi.importActual<any>(
    "../../../src/lib/index.ts",
  );
  return {
    ...originalModule,
    asyncHandler: (fn: any) => (req: any, res: any, next: any) => {
      return Promise.resolve(fn(req, res, next)).catch(next);
    },
  };
});

describe("User Controller Tests", () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: any;
  let mockDb: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockDb = {
      user: {
        delete: vi.fn(),
        upsert: vi.fn(),
        update: vi.fn(),
      },
    };

    (getSecuredClient as any).mockReturnValue(mockDb);

    mockReq = {
      oidc: {
        isAuthenticated: vi.fn().mockReturnValue(true),
        logout: vi.fn(),
        user: {
          sub: "auth0|12345",
          email: "alex@test.com",
          given_name: "Alex",
          family_name: "Doe",
          picture: "avatar.jpg",
          role: "Guest",
        },
      },
      user: { id: "db-user-id-99" },
      body: {},
    };

    mockRes = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
      oidc: { logout: vi.fn() },
    };

    mockNext = vi.fn();
  });

  describe("deleteUser", () => {
    test("should delete the user and return 200 success", async () => {
      const fakeDeletedUser = { id: "db-user-id-99", name: "Deleted Guy" };
      mockDb.user.delete.mockResolvedValue(fakeDeletedUser);

      await deleteUser(mockReq, mockRes, mockNext);

      expect(mockDb.user.delete).toHaveBeenCalledWith({
        where: { auth0Id: "auth0|12345" },
      });
      expect(mockRes.json).toHaveBeenCalled();
      const response = mockRes.json.mock.calls[0][0];
      expect(response.message).toBe("User deleted successfully");
    });

    test("should call next(error) if database fails", async () => {
      const dbError = new Error("Database connection failed");
      mockDb.user.delete.mockRejectedValue(dbError);

      await deleteUser(mockReq, mockRes, mockNext);

      expect(mockRes.json).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalledWith(dbError);
    });
  });

  describe("loginUser", () => {
    test("should upsert user and return 200 success", async () => {
      const fakeUser = {
        id: "user-1",
        email: "alex@test.com",
        firstName: "Alex",
      };
      mockDb.user.upsert.mockResolvedValue(fakeUser);

      await loginUser(mockReq, mockRes, mockNext);

      expect(mockDb.user.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { auth0Id: "auth0|12345" },
          create: expect.objectContaining({
            email: "alex@test.com",
            firstName: "Alex",
          }),
        }),
      );

      expect(mockRes.json).toHaveBeenCalled();
      const response = mockRes.json.mock.calls[0][0];
      expect(response.message).toBe("User Login Successfully");
    });

    test("should throw 401 if user is NOT authenticated", async () => {
      mockReq.oidc.isAuthenticated.mockReturnValue(false);
      mockReq.oidc.user = undefined;

      await loginUser(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      const error = mockNext.mock.calls[0][0];
      expect(error.statusCode).toBe(401);
    });
  });

  describe("logout", () => {
    test("should call oidc.logout and return success", async () => {
      await logout(mockReq, mockRes, mockNext);

      expect(mockRes.oidc.logout).toHaveBeenCalled();
      expect(mockRes.json).toHaveBeenCalled();
      const response = mockRes.json.mock.calls[0][0];
      expect(response.message).toBe("User logout Successfully");
    });
  });

  describe("updateUserProfile", () => {
    test("should update user and return 200 success", async () => {
      mockReq.body = {
        firstName: "NewName",
        lastName: "NewLast",
        phoneNo: "123",
      };

      const fakeUpdatedUser = { id: "db-user-id-99", firstName: "NewName" };
      mockDb.user.update.mockResolvedValue(fakeUpdatedUser);

      await updateUserProfile(mockReq, mockRes, mockNext);

      // --- FIXED: WRAPPED IN expect.objectContaining TO IGNORE SELECT ---
      expect(mockDb.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "db-user-id-99" },
          data: expect.objectContaining({
            firstName: "NewName",
            lastName: "NewLast",
            phoneNo: "123",
          }),
        })
      );

      expect(mockRes.json).toHaveBeenCalled();
      const response = mockRes.json.mock.calls[0][0];
      expect(response.message).toBe("User updated successfully");
    });

    test("should throw 400 if user ID (sub) is missing", async () => {
      mockReq.oidc.user.sub = undefined;

      await updateUserProfile(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(ApiError));
      const error = mockNext.mock.calls[0][0];
      expect(error.message).toBe("User ID is required to update profile");
      expect(error.statusCode).toBe(400);
    });
  });
});