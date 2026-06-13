import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  plugins: [
    // unplugin-swc handles TypeScript decorator metadata so vitest
    // can run NestJS code without the full ts-node + tsc pipeline.
    swc.vite({
      module: { type: 'commonjs' },
      jsc: {
        parser: {
          syntax: 'typescript',
          decorators: true,
          dynamicImport: true,
        },
        transform: {
          decoratorMetadata: true,
          legacyDecorator: true,
        },
        target: 'es2021',
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.spec.ts', 'src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
    // Alias workspace packages to their source during tests
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
