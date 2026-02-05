class ApiResponse<T> {
  message: string;
  data: T | null;
  statusCode: number;
  success: boolean;

  constructor(data: T | null, message: string = "Success", statusCode: number) {
    this.message = message;
    this.statusCode = statusCode;
    this.data = data;
    this.success = statusCode < 400;
  }
}

export default ApiResponse;
