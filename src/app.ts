import express, {
  type ErrorRequestHandler,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import hpp from "hpp";
import morgan from "morgan";
import dotenv from "dotenv";
import pkg from "express-openid-connect";
import { auth0middleware } from "./utils/auth/auth0-utils.ts";

const { requiresAuth } = pkg;
const app = express();
dotenv.config({ path: "./.env" });
const port = process.env.PORT;

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

app.get("/", (req, res) => {
  res.send(req.oidc.isAuthenticated() ? "Logged in" : "Logged out");
});
app.get("/profile", requiresAuth(), (req: Request, res: Response) => {
  res.json({
    user: req.oidc.user,
  });
});

app.use(
  (
    err: ErrorRequestHandler,
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    console.error(err);
  },
);

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
