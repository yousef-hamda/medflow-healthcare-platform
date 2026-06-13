import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/tests/**', 'src/index.ts', 'src/telemetry.ts'],
    },
  },
  resolve: {
    // Allow vitest to resolve workspace packages without building them
    alias: {
      '@medflow/shared-types': new URL(
        '../../packages/shared-types/src/index.ts',
        import.meta.url,
      ).pathname,
      '@medflow/fhir-types': new URL(
        '../../packages/fhir-types/src/index.ts',
        import.meta.url,
      ).pathname,
    },
  },
});
