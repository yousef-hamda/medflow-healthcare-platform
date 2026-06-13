import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.pact.test.ts"],
    // Pact mock servers are stateful; keep specs serial within a file and avoid
    // parallel files fighting over ports.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    reporters: ["default"],
  },
});
