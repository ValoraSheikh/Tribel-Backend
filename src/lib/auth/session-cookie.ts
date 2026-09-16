export interface SessionCookieEnv {
  nodeEnv: string | undefined;
  cookieDomain: string | undefined;
  baseUrl: string | undefined;
  frontendUrl: string | undefined;
}

export interface SessionCookieOptions {
  secure: boolean;
  sameSite: "None" | "Lax";
  domain?: string;
}

const hostOf = (value: string | undefined): string | null => {
  if (!value) return null;

  try {
    return new URL(/^https?:\/\//.test(value) ? value : `https://${value}`)
      .hostname;
  } catch {
    return null;
  }
};

const parentDomainOf = (host: string): string =>
  host.split(".").slice(-2).join(".");

const coversHost = (domain: string, host: string): boolean => {
  const scoped = domain.replace(/^\./, "").toLowerCase();
  const target = host.toLowerCase();

  return target === scoped || target.endsWith(`.${scoped}`);
};

export function resolveSessionCookie(
  env: SessionCookieEnv,
): SessionCookieOptions {
  const isProduction = env.nodeEnv === "production";

  return {
    secure: isProduction,
    sameSite: isProduction ? "None" : "Lax",
    ...(env.cookieDomain ? { domain: env.cookieDomain } : {}),
  };
}

/**
 * The Auth0 session cookie is host-only unless COOKIE_DOMAIN is set. When the
 * frontend runs on a different host than the backend, a host-only cookie can
 * never reach the frontend, so every server-side session read (and the proxy
 * guard) sees an anonymous user and bounces back to /login — a login loop.
 *
 * Returns a description of that misconfiguration, or null when the cookie can
 * reach the frontend.
 */
export function describeSessionCookieProblem(
  env: SessionCookieEnv,
): string | null {
  if (env.nodeEnv !== "production") return null;

  const backendHost = hostOf(env.baseUrl);
  const frontendHost = hostOf(env.frontendUrl);

  // Same host (ports differ at most): a host-only cookie is shared correctly.
  if (!backendHost || !frontendHost || backendHost === frontendHost) return null;

  if (!env.cookieDomain) {
    const backendParent = parentDomainOf(backendHost);
    const suggestion =
      backendParent === parentDomainOf(frontendHost)
        ? ` Set COOKIE_DOMAIN=.${backendParent}.`
        : ` Set COOKIE_DOMAIN to a domain covering both "${backendHost}" and "${frontendHost}".`;

    return (
      `Auth0 session cookie is host-only for "${backendHost}" while the frontend runs on ` +
      `"${frontendHost}", so the browser never sends it to the frontend. Every guarded ` +
      `route will redirect back to /login (login loop).${suggestion}`
    );
  }

  if (!coversHost(env.cookieDomain, frontendHost)) {
    return (
      `COOKIE_DOMAIN="${env.cookieDomain}" does not cover the frontend host ` +
      `"${frontendHost}", so the session cookie will not reach the frontend.`
    );
  }

  return null;
}
