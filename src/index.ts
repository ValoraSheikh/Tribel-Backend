import type { NextFunction, Request, Response } from "express";
import dotenv from "dotenv";
import { app } from "./app.ts";

dotenv.config({ path: "./.env" });
const port = process.env.PORT;

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || "Internal Server Error";
  console.error(err)
  return res.status(statusCode).json({
    status: statusCode,
    message: message,
  });
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
