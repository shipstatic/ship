/**
 * @file Vitest setup for CLI tests with API mocking
 * Simple setup following "impossible simplicity" philosophy
 */

import { beforeAll, afterAll, afterEach } from 'vitest';
import { setupMockServer, cleanupMockServer, resetMockServer } from './mocks/server';

// Setup mock server for all tests with timeout
beforeAll(async () => {
  await setupMockServer();
  // Give server time to fully start
  await new Promise(resolve => setTimeout(resolve, 100));
}, 10000);

// Cleanup after all tests
afterAll(async () => {
  await cleanupMockServer();
}, 5000);

// Reset handlers between tests for isolation
afterEach(() => {
  resetMockServer();
});