import express, {
  type ErrorRequestHandler,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import dotenv from "dotenv";
import { app } from "./app.ts";

dotenv.config({ path: "./.env" });
const port = process.env.PORT;

app.use(
  (
    err: ErrorRequestHandler,
    _req: Request,
    _res: Response,
    _next: NextFunction,
  ) => {
    console.error(err);
  },
);

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
