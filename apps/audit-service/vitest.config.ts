import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["src/__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/main.ts", "src/telemetry.ts", "src/__tests__/**"],
    },
  },
  resolve: {
    // Allow vitest to resolve @medflow/shared-types from the workspace
    alias: {},
  },
});
