import { describe, expect, test } from "vitest";
import {
  buildFrontendRedirect,
  DEFAULT_FRONTEND_RETURN_PATH,
  getSafeReturnPath,
  isSafeRelativePath,
  normalizeFrontendOrigin,
} from "../../../../src/lib/auth/return-to.ts";

describe("isSafeRelativePath", () => {
  test("accepts root and simple relative paths", () => {
    expect(isSafeRelativePath("/")).toBe(true);
    expect(isSafeRelativePath("/discover")).toBe(true);
    expect(isSafeRelativePath("/property/abc")).toBe(true);
    expect(isSafeRelativePath("/profile")).toBe(true);
  });

  test("accepts query strings and hashes", () => {
    expect(isSafeRelativePath("/bookings/new?propertyId=abc")).toBe(true);
    expect(isSafeRelativePath("/search?city=delhi&limit=10")).toBe(true);
    expect(isSafeRelativePath("/property/abc#reviews")).toBe(true);
  });

  test("rejects absolute external URLs", () => {
    expect(isSafeRelativePath("https://evil.example/path")).toBe(false);
    expect(isSafeRelativePath("http://evil.example")).toBe(false);
    expect(isSafeRelativePath("https://tribel.in/other")).toBe(false);
  });

  test("rejects protocol-relative URLs", () => {
    expect(isSafeRelativePath("//evil.example/path")).toBe(false);
    expect(isSafeRelativePath("///evil.example/path")).toBe(false);
  });

  test("rejects backslash forms", () => {
    expect(isSafeRelativePath("/\\evil.example")).toBe(false);
    expect(isSafeRelativePath("\\evil.example")).toBe(false);
  });

  test("rejects control characters", () => {
    expect(isSafeRelativePath("/path\r\n")).toBe(false);
    expect(isSafeRelativePath("/path\u0000")).toBe(false);
    expect(isSafeRelativePath("/pa\u007fth")).toBe(false);
  });

  test("rejects non-strings and empty values", () => {
    expect(isSafeRelativePath(undefined)).toBe(false);
    expect(isSafeRelativePath(null)).toBe(false);
    expect(isSafeRelativePath(42)).toBe(false);
    expect(isSafeRelativePath("")).toBe(false);
    expect(isSafeRelativePath("discover")).toBe(false);
  });
});

describe("getSafeReturnPath", () => {
  test("returns the path when valid", () => {
    expect(getSafeReturnPath("/yourBookings")).toBe("/yourBookings");
    expect(getSafeReturnPath("/bookings/new?propertyId=x")).toBe(
      "/bookings/new?propertyId=x",
    );
  });

  test("falls back to discover for invalid input", () => {
    expect(getSafeReturnPath("https://evil.example")).toBe(
      DEFAULT_FRONTEND_RETURN_PATH,
    );
    expect(getSafeReturnPath("//evil.example")).toBe(
      DEFAULT_FRONTEND_RETURN_PATH,
    );
    expect(getSafeReturnPath(undefined)).toBe(DEFAULT_FRONTEND_RETURN_PATH);
    expect(getSafeReturnPath("")).toBe(DEFAULT_FRONTEND_RETURN_PATH);
  });
});

describe("buildFrontendRedirect", () => {
  test("builds a URL from origin and safe path", () => {
    expect(buildFrontendRedirect("https://tribel.in", "/discover")).toBe(
      "https://tribel.in/discover",
    );
    expect(
      buildFrontendRedirect("https://tribel.in", "/bookings/new?propertyId=x"),
    ).toBe("https://tribel.in/bookings/new?propertyId=x");
  });

  test("never redirects outside the frontend origin", () => {
    const redirect = buildFrontendRedirect(
      "https://tribel.in",
      "https://evil.example/path",
    );
    expect(redirect.startsWith("https://tribel.in")).toBe(true);
    expect(redirect).toBe("https://tribel.in/discover");
  });

  test("handles a trailing-slash origin without producing double slashes", () => {
    expect(buildFrontendRedirect("https://tribel.in/", "/discover")).toBe(
      "https://tribel.in/discover",
    );
  });
});

describe("normalizeFrontendOrigin", () => {
  test("adds https when the protocol is missing", () => {
    expect(normalizeFrontendOrigin("tribel.in")).toBe("https://tribel.in");
    expect(normalizeFrontendOrigin("localhost:3001")).toBe(
      "https://localhost:3001",
    );
  });

  test("preserves an existing protocol and strips paths", () => {
    expect(normalizeFrontendOrigin("https://tribel.in/")).toBe(
      "https://tribel.in",
    );
    expect(normalizeFrontendOrigin("http://localhost:3001/")).toBe(
      "http://localhost:3001",
    );
  });
});
