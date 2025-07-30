import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import path from 'path';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node', // Use Node environment for all tests
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'], // API mocking - enabled for E2E tests
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'), // Map @ to src directory
      // We can keep the tsconfigPaths plugin as it might handle other cases or be more robust
      // but adding a direct @ alias is common.
    },
  },
});
