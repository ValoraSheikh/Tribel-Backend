import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 20000,
    hookTimeout: 30000,
    teardownTimeout: 10000,
    fileParallelism: false,
    env: {
      APP_DATABASE_URL: "postgresql://aman:secret@localhost:5433/tribel",
      DATABASE_URL: "postgresql://aman:secret@localhost:5433/tribel",
      REDIS_URL: "redis://127.0.0.1:6379",
    },
  },
});
