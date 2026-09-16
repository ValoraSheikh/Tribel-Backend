import { afterEach, describe, expect, test, vi } from "vitest";
import {
  describeSessionCookieProblem,
  resolveSessionCookie,
  type SessionCookieEnv,
} from "../../../../src/lib/auth/session-cookie.ts";

interface NormalizedAuth0Config {
  session: {
    name: string;
    cookie: {
      secure?: boolean;
      sameSite?: string;
      domain?: string;
      httpOnly?: boolean;
    };
  };
}

const PRODUCTION_ENV: SessionCookieEnv = {
  nodeEnv: "production",
  cookieDomain: undefined,
  baseUrl: "https://api.tribel.in",
  frontendUrl: "https://tribel.in",
};

describe("resolveSessionCookie", () => {
  test("is Secure + SameSite=None in production", () => {
    expect(resolveSessionCookie(PRODUCTION_ENV)).toEqual({
      secure: true,
      sameSite: "None",
    });
  });

  test("adds the shared parent domain when COOKIE_DOMAIN is set", () => {
    expect(
      resolveSessionCookie({ ...PRODUCTION_ENV, cookieDomain: ".tribel.in" }),
    ).toEqual({ secure: true, sameSite: "None", domain: ".tribel.in" });
  });

  test("stays host-only and Lax outside production", () => {
    expect(
      resolveSessionCookie({
        nodeEnv: "development",
        cookieDomain: undefined,
        baseUrl: "http://localhost:3000",
        frontendUrl: "http://localhost:3001",
      }),
    ).toEqual({ secure: false, sameSite: "Lax" });
  });
});

describe("describeSessionCookieProblem", () => {
  test("reports the production login loop when the cookie stays host-only", () => {
    const problem = describeSessionCookieProblem(PRODUCTION_ENV);

    expect(problem).toContain("COOKIE_DOMAIN=.tribel.in");
    expect(problem).toContain("login loop");
  });

  test("is quiet once COOKIE_DOMAIN covers the frontend", () => {
    expect(
      describeSessionCookieProblem({
        ...PRODUCTION_ENV,
        cookieDomain: ".tribel.in",
      }),
    ).toBeNull();
  });

  test("is quiet when frontend and backend share a host", () => {
    expect(
      describeSessionCookieProblem({
        nodeEnv: "production",
        cookieDomain: undefined,
        baseUrl: "https://localhost:3000",
        frontendUrl: "https://localhost:3001",
      }),
    ).toBeNull();
  });

  test("is quiet outside production", () => {
    expect(
      describeSessionCookieProblem({
        ...PRODUCTION_ENV,
        nodeEnv: "development",
      }),
    ).toBeNull();
  });

  test("reports a COOKIE_DOMAIN that does not cover the frontend host", () => {
    expect(
      describeSessionCookieProblem({
        ...PRODUCTION_ENV,
        cookieDomain: ".other.com",
      }),
    ).toContain("does not cover");
  });
});

/**
 * The cookie options only matter if they survive the SDK's own config
 * normalisation — `session.cookie` is the exact object `lib/appSession.js`
 * and `lib/transientHandler.js` hand to `res.cookie`, under the name
 * `session.name` (`appSession`).
 *
 * This deliberately does not mock express-openid-connect: the mock in
 * tests/unit/app.auth.test.ts replaces the SDK wholesale, which is why the
 * cookie scoping had no test to catch this bug. Driving the real login
 * handler instead is not possible off-box — `res.oidc.login()` performs live
 * OIDC discovery against the issuer — so the remaining end-to-end check is
 * the production curl documented in the fix plan.
 */
describe("Auth0 session cookie wiring", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const loadConfigNormalizer = async () => {
    const mod = (await import("express-openid-connect/lib/config")) as unknown as {
      get?: (config: unknown) => NormalizedAuth0Config;
      default?: { get: (config: unknown) => NormalizedAuth0Config };
    };
    const normalizer = mod.get ?? mod.default?.get;

    if (!normalizer) {
      throw new Error("express-openid-connect config normalizer not found");
    }

    return normalizer;
  };

  const normalizeSessionCookie = async (cookieDomain: string) => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BASE_URL", "https://api.tribel.in");
    vi.stubEnv("FRONTEND_URL", "https://tribel.in");
    vi.stubEnv("CLIENT_ID", "test-client");
    vi.stubEnv("CLIENT_SECRET", "test-secret-that-is-long-enough-for-joi");
    vi.stubEnv("ISSUER_BASE_URL", "test.auth0.com");
    vi.stubEnv("COOKIE_DOMAIN", cookieDomain);

    const { auth0Config } = await import(
      "../../../../src/lib/auth/auth0-utils.ts"
    );
    const normalize = await loadConfigNormalizer();

    return normalize(auth0Config);
  };

  test("scopes appSession to the parent domain so the frontend can read it", async () => {
    const config = await normalizeSessionCookie(".tribel.in");

    expect(config.session.name).toBe("appSession");
    expect(config.session.cookie).toMatchObject({
      domain: ".tribel.in",
      secure: true,
      sameSite: "None",
    });
  });

  test("leaves appSession host-only when COOKIE_DOMAIN is missing", async () => {
    const config = await normalizeSessionCookie("");

    expect(config.session.cookie.domain).toBeUndefined();
  });
});
