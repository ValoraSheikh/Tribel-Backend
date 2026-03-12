import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 20000,
    hookTimeout: 30000,
    teardownTimeout: 10000,
  },
});
