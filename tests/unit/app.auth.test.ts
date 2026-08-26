import { beforeEach, describe, expect, test, vi } from "vitest";
import request from "supertest";

const mockRedisGet = vi.fn();
const mockRedisSet = vi.fn();
const mockUserLookup = vi.fn();
const mockCreateUser = vi.fn();
let lastLoginOptions: unknown = null;

vi.mock("../../src/lib/redis/redis-cache.ts", () => ({
  default: {
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
    del: vi.fn(),
  },
}));

vi.mock("../../src/lib/redis/redis.ts", () => ({
  default: {},
}));

vi.mock("../../src/lib/user.ts", () => ({
  user: (...args: unknown[]) => mockUserLookup(...args),
  createUser: (...args: unknown[]) => mockCreateUser(...args),
}));

vi.mock("express-openid-connect", () => ({
  __esModule: true,
  default: {
    auth: () => (req: any, res: any, next: any) => {
      const rawUser = req.get("x-mock-oidc-user");
      const user = rawUser ? JSON.parse(rawUser) : null;

      req.oidc = {
        isAuthenticated: () => Boolean(user),
        user,
        login: vi.fn(),
        logout: vi.fn(),
      };

      res.oidc = {
        login: (opts: unknown) => {
          lastLoginOptions = opts;
          res.status(302).location("http://localhost:3000/auth0/start").end();
        },
        logout: vi.fn(),
      };

      next();
    },
    requiresAuth: () => (req: any, _res: any, next: any) => {
      if (!req.oidc?.isAuthenticated?.()) {
        const err = new Error("Not authenticated") as Error & {
          statusCode?: number;
        };
        err.statusCode = 401;
        return next(err);
      }
      next();
    },
  },
}));

vi.mock("../../src/middleware/rate-limit.middleware", () => {
  const pass = (_req: any, _res: any, next: any) => next();
  return {
    rateLimit: () => pass,
    userRateLimit: pass,
    tenantRateLimit: pass,
    propertyRateLimit: pass,
    roomTemplateRateLimit: pass,
    bookingRateLimit: pass,
    loginRateLimit: pass,
    publicGetRateLimit: pass,
  };
});

vi.stubEnv("NODE_ENV", "test");
vi.stubEnv("FRONTEND_URL", "https://tribel.in");
vi.stubEnv("CLIENT_SECRET", "test-secret");
vi.stubEnv("BASE_URL", "http://localhost:3000");
vi.stubEnv("CLIENT_ID", "test-client");
vi.stubEnv("ISSUER_BASE_URL", "test.auth0.com");
vi.stubEnv("AWS_REGION", "us-east-1");
vi.stubEnv("AWS_ACCESS_KEY", "test");
vi.stubEnv("AWS_SECRET_ACCESS_KEY", "test");

const { app } = await import("../../src/app.ts");

describe("Auth return-to flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastLoginOptions = null;
  });

  describe("GET /auth/login", () => {
    test("passes a safe returnTo through the bridge URL", async () => {
      await request(app)
        .get("/auth/login?returnTo=%2FyourBookings")
        .expect(302);

      expect(lastLoginOptions).toEqual({
        returnTo: "/auth/bridge?returnTo=%2FyourBookings",
      });
    });

    test("falls back to /discover when returnTo is missing", async () => {
      await request(app).get("/auth/login").expect(302);

      expect(lastLoginOptions).toEqual({
        returnTo: "/auth/bridge?returnTo=%2Fdiscover",
      });
    });

    test("falls back to /discover when returnTo is an external URL", async () => {
      await request(app)
        .get("/auth/login?returnTo=https%3A%2F%2Fevil.example%2Fpath")
        .expect(302);

      expect(lastLoginOptions).toEqual({
        returnTo: "/auth/bridge?returnTo=%2Fdiscover",
      });
    });
  });

  describe("GET /auth/bridge", () => {
    test("returns 401 for unauthenticated users", async () => {
      await request(app).get("/auth/bridge").expect(401);
    });

    test("redirects a cached user to the safe frontend path", async () => {
      const cachedUser = JSON.stringify({
        id: "user-1",
        role: "Guest",
        email: "a@b.com",
        name: "A",
      });
      mockRedisGet.mockResolvedValueOnce(cachedUser);

      const res = await request(app)
        .get("/auth/bridge?returnTo=%2Fprofile")
        .set("x-mock-oidc-user", JSON.stringify({ sub: "auth0|1" }))
        .expect(302);

      expect(res.headers.location).toBe("https://tribel.in/profile");
    });

    test("creates a user when none exists and redirects safely", async () => {
      mockRedisGet.mockResolvedValueOnce(null);
      mockUserLookup.mockResolvedValueOnce(null);
      mockCreateUser.mockResolvedValueOnce({
        id: "user-2",
        role: "Guest",
        firstName: "New",
        email: "new@b.com",
      });

      const res = await request(app)
        .get("/auth/bridge?returnTo=%2FcreateTenant")
        .set("x-mock-oidc-user", JSON.stringify({ sub: "auth0|2" }))
        .expect(302);

      expect(mockCreateUser).toHaveBeenCalled();
      expect(res.headers.location).toBe("https://tribel.in/createTenant");
    });

    test("never redirects to an external origin", async () => {
      mockRedisGet.mockResolvedValueOnce(null);
      mockUserLookup.mockResolvedValueOnce({
        id: "user-3",
        role: "Guest",
        firstName: "X",
        email: "x@b.com",
      });

      const res = await request(app)
        .get("/auth/bridge?returnTo=https%3A%2F%2Fevil.example%2Fpath")
        .set("x-mock-oidc-user", JSON.stringify({ sub: "auth0|3" }))
        .expect(302);

      expect(res.headers.location).toBe("https://tribel.in/discover");
    });
  });
});
