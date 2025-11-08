class ApiError extends Error {
  statusCode: number;
  status: "fail" | "error";
  isOperational: boolean;

  constructor(message: string = "Something went worng", statusCode: number) {
    super(message);
    this.message = message;
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith("4") ? "fail" : "error";
    this.isOperational = true;

    Error.captureStackTrace?.(this, this.constructor as unknown as Function);
  }
}

export default ApiError;
