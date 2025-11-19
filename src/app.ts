import express, { type Request, type Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import hpp from "hpp";
import morgan from "morgan";
import dotenv from "dotenv";
import pkg from "express-openid-connect";
import { auth0middleware } from "./utils/auth/auth0-utils.ts";

import userRouter from "./routes/user.route.ts";
import tenantRouter from "./routes/tenant.route.ts";
import propertyRouter from "./routes/property.route.ts";
import roomTemplateRouter from "./routes/roomTemplate.route.ts";
import bookingRouter from "./routes/booking.route.ts";

const { requiresAuth } = pkg;
const app = express();
dotenv.config({ path: "./.env" });

app.use(auth0middleware);
app.use(
  cors({
    origin: process.env.CORS_ORIGIN?.split(","),
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"],
  }),
);
app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true, limit: "16kb" }));
app.use(express.static("public"));
app.use(cookieParser());
app.use(helmet());
app.use(hpp());

if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

app.use("/api/v1/user", userRouter);
app.use("/api/v1/tenant", tenantRouter);
app.use("/api/v1/t/:tenantId/properties", propertyRouter);
app.use("/api/v1/p/:propertyId/roomTemplate", roomTemplateRouter);
app.use("/api/v1/booking", bookingRouter);

app.get("/", (req, res) => {
  res.send(req.oidc.isAuthenticated() ? "Logged in" : "Logged out");
});
app.get("/profile", requiresAuth(), (req: Request, res: Response) => {
  res.json({
    user: req.oidc.user,
  });
});

export { app };
