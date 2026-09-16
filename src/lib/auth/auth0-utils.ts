import logger from "../logger.ts";
import dotenv from "dotenv";
import pkg from "express-openid-connect";
import { resolveFrontendUrl } from "./return-to.ts";
import {
  describeSessionCookieProblem,
  resolveSessionCookie,
  type SessionCookieEnv,
} from "./session-cookie.ts";

dotenv.config({ path: "./.env" });
const { auth } = pkg;
type Auth0Config = Parameters<typeof auth>[0];

if (
  !process.env.CLIENT_SECRET ||
  !process.env.BASE_URL ||
  !process.env.CLIENT_ID
) {
  logger.error("Missing one or more required Auth0 environment variables.");
  process.exit(1);
}

const sessionCookieEnv: SessionCookieEnv = {
  nodeEnv: process.env.NODE_ENV,
  cookieDomain: process.env.COOKIE_DOMAIN,
  baseUrl: process.env.BASE_URL,
  frontendUrl: resolveFrontendUrl(
    process.env.NODE_ENV,
    process.env.FRONTEND_URL,
  ),
};

const sessionCookieProblem = describeSessionCookieProblem(sessionCookieEnv);
if (sessionCookieProblem) logger.error(sessionCookieProblem);

export const auth0Config: Auth0Config = {
  authRequired: false,
  auth0Logout: true,
  secret: process.env.CLIENT_SECRET,
  baseURL: process.env.BASE_URL,
  clientID: process.env.CLIENT_ID,
  issuerBaseURL: `https://${process.env.ISSUER_BASE_URL}`,
  authorizationParams: {
    scope: "openid profile email",
    // connection: "google-oauth2",
    prompt: "consent",
    response_mode: "form_post",
    
  },
  session: {
    rolling: true,
    cookie: resolveSessionCookie(sessionCookieEnv),
  },
  routes: {
    login: false,
    logout: false,
    callback: "/callback",
  },
};

export const auth0middleware = auth(auth0Config);
