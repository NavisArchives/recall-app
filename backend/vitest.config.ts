import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./src/__tests__/setup.ts", "./src/__tests__/support/tenantWriteGuard.ts"],
    include: ["src/**/*.test.ts"],
    // The staging suite needs a real database and runs under its own config.
    exclude: ["src/__tests__/staging/**"],
  },
});
