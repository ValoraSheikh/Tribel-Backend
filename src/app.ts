import express, { type Request, type Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import hpp from "hpp";
import morgan from "morgan";
import dotenv from "dotenv";
import { createUser, user, type UserDetail } from "./lib/user.ts";
import { loginRateLimit } from "./middleware/rate-limit.middleware.ts";
import { auth0middleware } from "./lib/auth/auth0-utils.ts";

import userRouter from "./routes/user.route.ts";
import tenantRouter from "./routes/tenant.route.ts";
import propertyRouter from "./routes/property.route.ts";
import roomTemplateRouter from "./routes/roomTemplate.route.ts";
import bookingRouter from "./routes/booking.route.ts";
import uploadRouter from "./routes/upload.route.ts"
import paymentRouter from "./routes/razorpay.route.ts";
import invoiceRouter from "./routes/invoice.route.ts";
import client from "./lib/redis/redis-cache.ts";
import type { AuthUser } from "./controller/user.controller.ts";

const app = express();
dotenv.config({ path: "./.env" });

app.set("trust proxy", true);
app.use(auth0middleware);
app.use(
  cors({
    origin: process.env.CORS_ORIGIN?.split(","),
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"],
  }),
);
app.use(express.json({
  limit: "16kb",
  verify: (req: Request, _res: Response, buf: Buffer) => {
    (req as any).rawBody = buf;
  },
}));
app.use(express.urlencoded({ extended: true, limit: "16kb" }));
app.use(express.static("public"));
app.use(cookieParser());
app.use(helmet());
app.use(hpp());

if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

app.get("/", (req, res) => {
  res.send(req.oidc.isAuthenticated() ? "Logged in" : "Logged out");
});

app.get("/logout", async (req, res, next) => {
  try {
    const isAuthenticated = req.oidc?.isAuthenticated() ?? false;

    if (!isAuthenticated || !req.oidc?.user) {
      return res.redirect("http://localhost:3001");
    }

    const authUser = req.oidc.user as AuthUser;

    await client.del(`user:${authUser.sub}`);
    await client.del(`session:${authUser.sub}`);

    res.oidc.logout({
      returnTo: "http://localhost:3001",
    });
  } catch (err) {
    next(err);
  }
});

app.get("/profile", (req: Request, res: Response) => {
  const isAuthenticated = req.oidc?.isAuthenticated?.() ?? false;

  if (!isAuthenticated || !req.oidc?.user) {
    return res.status(200).json({
      isAuthenticated: false,
      user: null,
    });
  }

  return res.json({
    isAuthenticated: true,
    user: req.oidc.user,
  });
});

app.use("/auth/login", loginRateLimit, (_req, res, _next) => {
  res.oidc.login({
    returnTo: "/auth/bridge",
  });
});

app.get("/auth/bridge", async (req, res, next) => {
  try {
    if (!req.oidc?.user) {
      return res.status(401).send("Not authenticated");
    }

    const auth0User = req.oidc.user as UserDetail;

    const cacheUser = await client.get(`session:${auth0User.sub}`);
    if (cacheUser) {
      req.user = JSON.parse(cacheUser);
      return res.redirect("http://localhost:3001/");
    }

    let found = await user(auth0User.sub);
    if (!found) {
      found = await createUser(auth0User);
    }

    req.user = {
      id: found.id,
      role: found.role,
      email: found.email,
      name: found.firstName,
    };

    await client.set(
      `session:${auth0User.sub}`,
      JSON.stringify(req.user),
      "EX",
      3600,
    );

    // FINAL STEP: send user back to frontend app
    return res.redirect("http://localhost:3001/");
  } catch (err) {
    next(err);
  }
});

app.use(async (req, _res, next) => {
  try {
    if (req.oidc?.user) {
      const auth0User = req.oidc.user as UserDetail;
      const cacheUser = await client.get(`session:${auth0User.sub}`);
      if (cacheUser) {
        req.user = JSON.parse(cacheUser);
        return next();
      }

      let found = await user(auth0User.sub);
      if (!found) {
        found = await createUser(auth0User);
      }
      req.user = {
        id: found.id,
        role: found.role,
        email: found.email,
        name: found.firstName,
      };

      await client.set(
        `session:${auth0User.sub}`,
        JSON.stringify(req.user),
        "EX",
        3600,
      );
    }

    next();
  } catch (err) {
    next(err);
  }
});

app.use("/api/v1/user", userRouter);
app.use("/api/v1/tenant", tenantRouter);
app.use("/api/v1/properties", propertyRouter);
app.use("/api/v1/p/:propertyId/roomTemplate", roomTemplateRouter);
app.use("/api/v1/booking", bookingRouter);
app.use("/api/v1/uploads", uploadRouter);
app.use("/api/v1/payment", paymentRouter);
app.use("/api/v1/invoice", invoiceRouter);

export { app };
