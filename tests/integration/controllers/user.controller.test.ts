import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  loginUser,
  logout,
  updateUserProfile,
  deleteUser,
} from "../../../src/controller/user.controller.ts";
import testDB, { resetTestDatabase } from "../../setup.ts";

// 1. MOCK REDIS SO IT ALWAYS HITS THE DATABASE
vi.mock("../../../src/lib/redis/redis-cache.ts", () => ({
  default: {
    get: vi.fn().mockResolvedValue(null), // Force a cache miss
    set: vi.fn(),
    del: vi.fn(),
  },
}));

vi.mock("../../../src/lib/redis/redis.ts", () => ({
  default: {},
}));

describe("Integration: User Controller Suite", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const mockNext = vi.fn();

  const setupMockHttp = (
    isAuthenticated: boolean,
    oidcUserPayload?: any,
    reqUser?: any,
    reqBody?: any,
  ) => {
    const req: any = {
      oidc: {
        isAuthenticated: vi.fn().mockReturnValue(isAuthenticated),
        user: oidcUserPayload,
      },
      user: reqUser || {},
      body: reqBody || {},
    };

    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      oidc: {
        logout: vi.fn(),
      },
    };

    return { req, res };
  };

  const executeControllerAndWait = (
    controllerFn: (...args: unknown[]) => unknown,
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

  // --- LOGIN USER TESTS ---
  describe("loginUser", () => {
    it("should throw a 401 ApiError if the user is not authenticated via Auth0", async () => {
      const { req, res } = setupMockHttp(false);
      try {
        await executeControllerAndWait(loginUser, req, res, mockNext);
      } catch (errorArg: any) {
        expect(mockNext).toHaveBeenCalledTimes(1);
        expect(errorArg.statusCode).toBe(401);
      }
    });

    it("should create a new user in the database on first login", async () => {
      const auth0Payload = {
        given_name: "John",
        family_name: "Doe",
        nickname: "johndoe",
        email: "john@example.com",
        picture: "https://example.com/avatar.jpg",
        role: "Guest",
        sub: "auth0|12345",
      };

      const { req, res } = setupMockHttp(true, auth0Payload);
      await executeControllerAndWait(loginUser, req, res, mockNext);

      const dbUser = await testDB.user.findUnique({
        where: { auth0Id: auth0Payload.sub },
      });
      expect(dbUser).toBeDefined();
      expect(dbUser?.firstName).toBe("John");
    });
  });

  // --- LOGOUT TESTS ---
  describe("logout", () => {
    it("should throw 401 if trying to logout while not authenticated", async () => {
      const { req, res } = setupMockHttp(false);
      try {
        await executeControllerAndWait(logout, req, res, mockNext);
      } catch (error: any) {
        expect(error.statusCode).toBe(401);
      }
    });

    it("should call res.oidc.logout and return success", async () => {
      // 2. ADDED THE MISSING AUTH0 PAYLOAD HERE
      const { req, res } = setupMockHttp(true, { sub: "auth0|logout-test" });
      await executeControllerAndWait(logout, req, res, mockNext);

      expect(res.oidc.logout).toHaveBeenCalled();
      const response = res.json.mock.calls[0][0];
      expect(response.message).toBe("User logout Successfully");
    });
  });

  // --- UPDATE PROFILE TESTS ---
  describe("updateUserProfile", () => {
    it("should update user details (firstName, lastName, phoneNo)", async () => {
      const existing = await testDB.user.create({
        data: {
          auth0Id: "auth0|update",
          email: "old@test.com",
          firstName: "Old",
          lastName: "User",
          role: "Guest",
        },
      });

      const updateData = {
        firstName: "NewName",
        lastName: "NewLast",
        phoneNo: "9999999999",
      };

      const { req, res } = setupMockHttp(
        true,
        { sub: "auth0|update" },
        { id: existing.id },
        updateData,
      );

      await executeControllerAndWait(updateUserProfile, req, res, mockNext);

      const updated = await testDB.user.findUnique({
        where: { id: existing.id },
      });
      expect(updated?.firstName).toBe("NewName");
      expect(updated?.phoneNo).toBe("9999999999");
    });

    it("should throw 400 if sub is missing from oidc user", async () => {
      const { req, res } = setupMockHttp(true, {}, { id: "some-id" });
      try {
        await executeControllerAndWait(updateUserProfile, req, res, mockNext);
      } catch (error: any) {
        expect(error.statusCode).toBe(400);
        expect(error.message).toContain("User ID is required");
      }
    });
  });

  // --- DELETE USER TESTS ---
  describe("deleteUser", () => {
    it("should successfully delete a user from the database", async () => {
      const user = await testDB.user.create({
        data: {
          auth0Id: "auth0|delete",
          email: "delete@test.com",
          firstName: "Bye",
          lastName: "User",
          role: "Guest",
        },
      });

      const { req, res } = setupMockHttp(
        true,
        { sub: "auth0|delete" },
        { id: user.id },
      );

      await executeControllerAndWait(deleteUser, req, res, mockNext);

      const check = await testDB.user.findUnique({ where: { id: user.id } });
      expect(check).toBeNull();

      const response = res.json.mock.calls[0][0];
      expect(response.message).toBe("User deleted successfully");
    });
  });
});