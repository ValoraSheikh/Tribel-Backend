import dotenv from "dotenv";
import pkg from "express-openid-connect";

dotenv.config({ path: "./.env" });
const { auth } = pkg;
type Auth0Config = Parameters<typeof auth>[0];

if (
  !process.env.CLIENT_SECRET ||
  !process.env.BASE_URL ||
  !process.env.CLIENT_ID
) {
  console.error("Missing one or more required Auth0 environment variables.");
  process.exit(1);
}

const config: Auth0Config = {
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
    cookie: {
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "None" : "Lax",
      ...(process.env.NODE_ENV === "production"
        ? {}
        : { domain: "localhost" }),
    },
  },
  routes: {
    logout: false,
    callback: "/callback",
  },
};

export const auth0middleware = auth(config);
