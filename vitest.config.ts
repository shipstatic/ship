import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import path from 'path';

/**
 * Vitest Configuration with Test Projects
 *
 * Separates tests by execution requirements:
 * - unit: Pure function tests, no mock server needed (fast)
 * - integration: SDK/CLI tests with mocked API (medium)
 * - e2e: Real API tests (slow, requires credentials)
 *
 * File naming convention:
 * - *.unit.test.ts → unit project
 * - *.e2e.test.ts → e2e project
 * - *.test.ts → integration project (default)
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
    // Disable file parallelism for integration tests that share mock server
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/**/*.unit.test.ts'],
          setupFiles: [],
          testTimeout: 5000,
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/**/*.unit.test.ts', 'tests/**/*.e2e.test.ts'],
          setupFiles: ['tests/setup.ts'],
          testTimeout: 30000,
        },
      },
      {
        extends: true,
        test: {
          name: 'e2e',
          include: ['tests/**/*.e2e.test.ts'],
          setupFiles: ['tests/setup-e2e.ts'],
          testTimeout: 60000,
        },
      },
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
